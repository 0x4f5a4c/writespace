import { and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "../../db";
import { users } from "../../db/schema";
import { authSessions } from "@db/schema/auth-sessions";
import { refreshTokens } from "@db/schema/refresh-tokens";

import {
  securityEventRepository,
  SECURITY_EVENT_OUTCOMES,
  SECURITY_EVENT_TYPES,
} from "./security-event.repository";

/**
 * Transaction type shared with callers that need session revocation
 * to participate in a larger authentication transaction.
 */
export type RefreshTokenTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

export type RefreshTokenRotationResult =
  | {
      outcome: "rotated";
      sessionId: string;
      userId: string;
      role: string;
      idleExpiresAt: Date;
      absoluteExpiresAt: Date;
    }
  | { outcome: "reused" }
  | { outcome: "invalid" }
  | { outcome: "inactive" };

/**
 * Handles durable refresh-token persistence and rotation.
 *
 * Raw refresh credentials are never accepted here. All lookups use
 * SHA-256 token digests supplied by SessionService.
 */
export class RefreshTokenRepository {
  /**
   * Atomically consumes a refresh token and creates its successor.
   *
   * Locking the existing token and session prevents concurrent requests
   * from creating multiple successors for the same refresh credential.
   *
   * Reuse of a consumed token revokes the entire affected session.
   */
  public async rotate(input: {
    tokenHash: string;
    replacementTokenHash: string;
    now: Date;
    idleTimeoutMs: number;
  }): Promise<RefreshTokenRotationResult> {
    return db.transaction(async (tx) => {
      const [record] = await tx
        .select({
          tokenId: refreshTokens.id,
          tokenExpiresAt: refreshTokens.expiresAt,
          tokenConsumedAt: refreshTokens.consumedAt,
          tokenRevokedAt: refreshTokens.revokedAt,

          sessionId: authSessions.id,
          userId: authSessions.userId,
          sessionRevokedAt: authSessions.revokedAt,
          idleExpiresAt: authSessions.idleExpiresAt,
          absoluteExpiresAt: authSessions.absoluteExpiresAt,

          accountStatus: users.status,
          role: users.role,
        })
        .from(refreshTokens)
        .innerJoin(authSessions, eq(authSessions.id, refreshTokens.sessionId))
        .innerJoin(users, eq(users.id, authSessions.userId))
        .where(eq(refreshTokens.tokenHash, input.tokenHash))
        .limit(1)
        .for("update");

      if (!record) {
        return { outcome: "invalid" };
      }

      // A consumed credential being presented again indicates possible
      // refresh-token theft. Revoke every credential for this session.
      if (record.tokenConsumedAt) {
        await tx
          .update(refreshTokens)
          .set({
            reuseDetectedAt: input.now,
            revokedAt: input.now,
          })
          .where(eq(refreshTokens.id, record.tokenId));

        await tx
          .update(authSessions)
          .set({
            revokedAt: input.now,
            revokeReason: "refresh_token_reuse",
          })
          .where(
            and(
              eq(authSessions.id, record.sessionId),
              isNull(authSessions.revokedAt),
            ),
          );

        await tx
          .update(refreshTokens)
          .set({ revokedAt: input.now })
          .where(
            and(
              eq(refreshTokens.sessionId, record.sessionId),
              isNull(refreshTokens.revokedAt),
            ),
          );

        // Record reuse detection in the same transaction as session
        // revocation so the audit record cannot be lost independently.
        await securityEventRepository.create(tx, {
          userId: record.userId,
          sessionId: record.sessionId,
          eventType: SECURITY_EVENT_TYPES.REFRESH_TOKEN_REUSE_DETECTED,
          outcome: SECURITY_EVENT_OUTCOMES.DETECTED,
          reason: "A previously consumed refresh token was presented again",
          metadata: {},
          occurredAt: input.now,
        });

        return { outcome: "reused" };
      }

      if (
        record.tokenRevokedAt ||
        record.sessionRevokedAt ||
        record.tokenExpiresAt.getTime() <= input.now.getTime() ||
        record.idleExpiresAt.getTime() <= input.now.getTime() ||
        record.absoluteExpiresAt.getTime() <= input.now.getTime()
      ) {
        return { outcome: "invalid" };
      }

      if (
        record.accountStatus === "suspended" ||
        record.accountStatus === "banned"
      ) {
        await tx
          .update(authSessions)
          .set({
            revokedAt: input.now,
            revokeReason: "account_inactive",
          })
          .where(
            and(
              eq(authSessions.id, record.sessionId),
              isNull(authSessions.revokedAt),
            ),
          );

        await tx
          .update(refreshTokens)
          .set({ revokedAt: input.now })
          .where(
            and(
              eq(refreshTokens.sessionId, record.sessionId),
              isNull(refreshTokens.revokedAt),
            ),
          );

        return { outcome: "inactive" };
      }

      const nextIdleExpiresAt = new Date(
        Math.min(
          input.now.getTime() + input.idleTimeoutMs,
          record.absoluteExpiresAt.getTime(),
        ),
      );

      // Create the successor before linking it to the consumed credential.
      const [successor] = await tx
        .insert(refreshTokens)
        .values({
          sessionId: record.sessionId,
          tokenHash: input.replacementTokenHash,
          parentTokenId: record.tokenId,
          issuedAt: input.now,
          expiresAt: nextIdleExpiresAt,
        })
        .returning({ id: refreshTokens.id });

      if (!successor) {
        throw new Error("Failed to create replacement refresh token");
      }

      await tx
        .update(refreshTokens)
        .set({
          consumedAt: input.now,
          replacedByTokenId: successor.id,
        })
        .where(eq(refreshTokens.id, record.tokenId));

      await tx
        .update(authSessions)
        .set({
          lastSeenAt: input.now,
          lastRefreshAt: input.now,
          idleExpiresAt: nextIdleExpiresAt,
        })
        .where(eq(authSessions.id, record.sessionId));

      // Record successful rotation in the same transaction as the
      // consumption of the previous credential and creation of its successor.
      await securityEventRepository.create(tx, {
        userId: record.userId,
        sessionId: record.sessionId,
        eventType: SECURITY_EVENT_TYPES.REFRESH_TOKEN_ROTATED,
        outcome: SECURITY_EVENT_OUTCOMES.SUCCESS,
        metadata: {},
        occurredAt: input.now,
      });

      return {
        outcome: "rotated",
        sessionId: record.sessionId,
        userId: record.userId,
        role: record.role,
        idleExpiresAt: nextIdleExpiresAt,
        absoluteExpiresAt: record.absoluteExpiresAt,
      };
    });
  }

  /**
   * Revokes the session associated with a presented refresh credential.
   *
   * Revoking the session also invalidates its access tokens once the
   * authentication middleware checks session state.
   *
   * The session revocation, refresh-token invalidation and security event
   * are committed together. An event is recorded only when this operation
   * actually transitions an active session into a revoked state.
   */
  public async revokeByTokenHash(
    tokenHash: string,
    now: Date,
    reason: string,
  ): Promise<void> {
    await db.transaction(async (tx) => {
      const [record] = await tx
        .select({
          sessionId: authSessions.id,
          userId: authSessions.userId,
          sessionRevokedAt: authSessions.revokedAt,
        })
        .from(refreshTokens)
        .innerJoin(authSessions, eq(authSessions.id, refreshTokens.sessionId))
        .where(eq(refreshTokens.tokenHash, tokenHash))
        .limit(1)
        .for("update");

      if (!record || record.sessionRevokedAt) {
        return;
      }

      await tx
        .update(authSessions)
        .set({
          revokedAt: now,
          revokeReason: reason,
        })
        .where(
          and(
            eq(authSessions.id, record.sessionId),
            isNull(authSessions.revokedAt),
          ),
        );

      await tx
        .update(refreshTokens)
        .set({ revokedAt: now })
        .where(
          and(
            eq(refreshTokens.sessionId, record.sessionId),
            isNull(refreshTokens.revokedAt),
          ),
        );

      // Record ordinary logout in the same transaction as revocation.
      await securityEventRepository.create(tx, {
        userId: record.userId,
        sessionId: record.sessionId,
        eventType: SECURITY_EVENT_TYPES.SESSION_REVOKED,
        outcome: SECURITY_EVENT_OUTCOMES.SUCCESS,
        reason,
        metadata: {},
        occurredAt: now,
      });
    });
  }

  /**
   * Revokes all active sessions and their refresh credentials for a user.
   *
   * This wrapper is used when the caller does not already have a
   * database transaction.
   */
  public async revokeAllForUser(
    userId: string,
    now: Date,
    reason: string,
    actorSessionId?: string,
  ): Promise<void> {
    await db.transaction(async (tx) => {
      await this.revokeAllForUserInTransaction(
        tx,
        userId,
        now,
        reason,
        actorSessionId,
      );
    });
  }

  /**
   * Revokes all active sessions using the caller's existing transaction.
   *
   * The user row is locked first to serialize this operation against
   * concurrent session creation for the same account.
   *
   * Session updates, refresh-token invalidation and the aggregate security
   * event are committed together.
   *
   * actorSessionId is optional because system-initiated operations such
   * as password reset may not have an authenticated actor session.
   */
  public async revokeAllForUserInTransaction(
    tx: RefreshTokenTransaction,
    userId: string,
    now: Date,
    reason: string,
    actorSessionId?: string,
  ): Promise<void> {
    const [account] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .for("update");

    if (!account) {
      return;
    }

    // Lock all currently active sessions before revoking them.
    const sessions = await tx
      .select({ id: authSessions.id })
      .from(authSessions)
      .where(
        and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)),
      )
      .for("update");

    const sessionIds = sessions.map((session) => session.id);

    if (sessionIds.length === 0) {
      return;
    }

    await tx
      .update(authSessions)
      .set({
        revokedAt: now,
        revokeReason: reason,
      })
      .where(inArray(authSessions.id, sessionIds));

    await tx
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(
        and(
          inArray(refreshTokens.sessionId, sessionIds),
          isNull(refreshTokens.revokedAt),
        ),
      );

    // Associate the aggregate event with the initiating session only
    // when that session is included in this revocation operation.
    const eventSessionId =
      actorSessionId && sessionIds.includes(actorSessionId)
        ? actorSessionId
        : null;

    // Keep the aggregate audit record atomic with the revocation.
    await securityEventRepository.create(tx, {
      userId,
      sessionId: eventSessionId,
      eventType: SECURITY_EVENT_TYPES.SESSIONS_REVOKED,
      outcome: SECURITY_EVENT_OUTCOMES.SUCCESS,
      reason,
      metadata: {
        revokedSessionCount: sessionIds.length,
      },
      occurredAt: now,
    });
  }
}

export const refreshTokenRepository = new RefreshTokenRepository();
