import { and, desc, eq, gt, inArray, isNull, ne } from "drizzle-orm";

import { db } from "../../db";
import { users } from "@db/schema";
import {
  authSessions,
  type AuthSession,
  type NewAuthSession,
} from "@db/schema/auth-sessions";
import { refreshTokens } from "@db/schema/refresh-tokens";
import type { RefreshTokenTransaction } from "./refresh-token.repository";

import {
  securityEventRepository,
  SECURITY_EVENT_OUTCOMES,
  SECURITY_EVENT_TYPES,
} from "./security-event.repository";

/**
 * Optional authentication-specific event recorded alongside session creation.
 *
 * The repository supplies userId, sessionId and occurredAt so callers
 * cannot accidentally associate the event with another account or session.
 */
export interface SessionCreationSecurityEvent {
  eventType: string;
  outcome: string;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Handles persistence operations for authentication sessions.
 *
 * Session lifecycle decisions belong to SessionService.
 * This repository is responsible only for database operations.
 */
export class SessionRepository {
  /**
   * Creates a session, its initial refresh-token record, and its
   * corresponding security events atomically.
   *
   * A caller may provide one additional authentication event, such as
   * a successful password login or OAuth login.
   */
  public async createWithInitialRefreshToken(
    sessionData: NewAuthSession,
    refreshTokenData: {
      tokenHash: string;
      issuedAt: Date;
      expiresAt: Date;
    },
    authenticationEvent?: SessionCreationSecurityEvent,
  ): Promise<AuthSession> {
    return db.transaction(async (tx) => {
      const [session] = await tx
        .insert(authSessions)
        .values(sessionData)
        .returning();

      if (!session) {
        throw new Error("Failed to create authentication session");
      }

      await tx.insert(refreshTokens).values({
        sessionId: session.id,
        tokenHash: refreshTokenData.tokenHash,
        issuedAt: refreshTokenData.issuedAt,
        expiresAt: refreshTokenData.expiresAt,
      });

      // Record session creation in the same transaction.
      await securityEventRepository.create(tx, {
        userId: session.userId,
        sessionId: session.id,
        eventType: SECURITY_EVENT_TYPES.SESSION_CREATED,
        outcome: SECURITY_EVENT_OUTCOMES.SUCCESS,
        metadata: {
          clientType: session.clientType,
          authMethods: session.authMethods,
        },
        occurredAt: session.createdAt,
      });

      // Record the authentication-specific event, when supplied.
      // Both events share the newly created session and transaction.
      if (authenticationEvent) {
        await securityEventRepository.create(tx, {
          userId: session.userId,
          sessionId: session.id,
          eventType: authenticationEvent.eventType,
          outcome: authenticationEvent.outcome,
          reason: authenticationEvent.reason ?? null,
          metadata: authenticationEvent.metadata ?? {},
          occurredAt: session.createdAt,
        });
      }

      return session;
    });
  }

  /**
   * Retrieves a session together with its current account status.
   *
   * Access-token authentication uses this to verify that the session
   * still belongs to the authenticated user and remains usable.
   */
  public async findForAccessValidation(sessionId: string, userId: string) {
    const [result] = await db
      .select({
        session: authSessions,
        accountStatus: users.status,
      })
      .from(authSessions)
      .innerJoin(users, eq(users.id, authSessions.userId))
      .where(
        and(eq(authSessions.id, sessionId), eq(authSessions.userId, userId)),
      )
      .limit(1);

    return result ?? null;
  }

  /**
   * Retrieves active, unrevoked and unexpired sessions belonging
   * to one account.
   *
   * The repository returns session records. SessionService is responsible
   * for preparing the safe user-facing response.
   */
  public async findActiveForUser(
    userId: string,
    now: Date,
  ): Promise<AuthSession[]> {
    return db
      .select()
      .from(authSessions)
      .where(
        and(
          eq(authSessions.userId, userId),
          isNull(authSessions.revokedAt),
          gt(authSessions.idleExpiresAt, now),
          gt(authSessions.absoluteExpiresAt, now),
        ),
      )
      .orderBy(desc(authSessions.createdAt));
  }

  /**
   * Retrieves one session only when it belongs to the supplied account.
   *
   * Ownership is enforced in the database query itself. A caller cannot
   * retrieve another account's session using its identifier.
   */
  public async findByIdForUser(
    sessionId: string,
    userId: string,
  ): Promise<AuthSession | null> {
    const [session] = await db
      .select()
      .from(authSessions)
      .where(
        and(eq(authSessions.id, sessionId), eq(authSessions.userId, userId)),
      )
      .limit(1);

    return session ?? null;
  }

  /**
   * Revokes one session belonging to the specified account.
   *
   * The session and all of its active refresh credentials are revoked
   * in one transaction. A security event is committed with the changes.
   *
   * Returns false when the session does not belong to the account
   * or does not exist. Repeated revocation of an owned session is safe.
   */
  public async revokeSessionForUser(
    sessionId: string,
    userId: string,
    now: Date,
    reason: string,
  ): Promise<boolean> {
    return db.transaction(async (tx) => {
      const [session] = await tx
        .select({
          id: authSessions.id,
          userId: authSessions.userId,
          revokedAt: authSessions.revokedAt,
        })
        .from(authSessions)
        .where(
          and(eq(authSessions.id, sessionId), eq(authSessions.userId, userId)),
        )
        .limit(1)
        .for("update");

      if (!session) {
        return false;
      }

      // Keep repeated DELETE requests idempotent.
      if (session.revokedAt) {
        return true;
      }

      await tx
        .update(authSessions)
        .set({
          revokedAt: now,
          revokeReason: reason,
        })
        .where(
          and(
            eq(authSessions.id, sessionId),
            eq(authSessions.userId, userId),
            isNull(authSessions.revokedAt),
          ),
        );

      // Refresh credentials must become unusable with their session.
      await tx
        .update(refreshTokens)
        .set({ revokedAt: now })
        .where(
          and(
            eq(refreshTokens.sessionId, sessionId),
            isNull(refreshTokens.revokedAt),
          ),
        );

      await securityEventRepository.create(tx, {
        userId,
        sessionId,
        eventType: SECURITY_EVENT_TYPES.SESSION_REVOKED,
        outcome: SECURITY_EVENT_OUTCOMES.SUCCESS,
        reason,
        metadata: {},
        occurredAt: now,
      });

      return true;
    });
  }

  /**
   * Revokes every other unrevoked session while preserving the
   * session that initiated the operation.
   *
   * This wrapper is for callers that do not already have a transaction.
   */
  public async revokeOtherSessionsForUser(
    userId: string,
    currentSessionId: string,
    now: Date,
    reason: string,
  ): Promise<number> {
    return db.transaction(async (tx) =>
      this.revokeOtherSessionsForUserInTransaction(
        tx,
        userId,
        currentSessionId,
        now,
        reason,
      ),
    );
  }

  /**
   * Performs other-session revocation inside the caller's transaction.
   *
   * This lets password changes and session revocation commit atomically.
   */
  public async revokeOtherSessionsForUserInTransaction(
    tx: RefreshTokenTransaction,
    userId: string,
    currentSessionId: string,
    now: Date,
    reason: string,
  ): Promise<number> {
    // Lock the account before examining its sessions.
    const [account] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .for("update");

    if (!account) {
      return 0;
    }

    const sessions = await tx
      .select({ id: authSessions.id })
      .from(authSessions)
      .where(
        and(
          eq(authSessions.userId, userId),
          ne(authSessions.id, currentSessionId),
          isNull(authSessions.revokedAt),
        ),
      )
      .for("update");

    const sessionIds = sessions.map((session) => session.id);

    if (sessionIds.length === 0) {
      return 0;
    }

    await tx
      .update(authSessions)
      .set({
        revokedAt: now,
        revokeReason: reason,
      })
      .where(
        and(
          eq(authSessions.userId, userId),
          inArray(authSessions.id, sessionIds),
          isNull(authSessions.revokedAt),
        ),
      );

    // Every refresh credential belonging to those sessions becomes unusable.
    await tx
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(
        and(
          inArray(refreshTokens.sessionId, sessionIds),
          isNull(refreshTokens.revokedAt),
        ),
      );

    // Record the bulk operation in the same transaction.
    await securityEventRepository.create(tx, {
      userId,
      sessionId: currentSessionId,
      eventType: SECURITY_EVENT_TYPES.SESSIONS_REVOKED,
      outcome: SECURITY_EVENT_OUTCOMES.SUCCESS,
      reason,
      metadata: {
        revokedSessionCount: sessionIds.length,
      },
      occurredAt: now,
    });

    return sessionIds.length;
  }
}

export const sessionRepository = new SessionRepository();
