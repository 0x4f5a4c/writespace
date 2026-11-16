import env from "@config/env";
import { createHash, randomBytes } from "crypto";
import {
  type AuthClientType,
  type AuthSession,
} from "@db/schema/auth-sessions";

import {
  RefreshTokenRepository,
  refreshTokenRepository,
  type RefreshTokenTransaction,
} from "./refresh-token.repository";
import {
  SessionRepository,
  sessionRepository,
  type SessionCreationSecurityEvent,
} from "./session.repository";

export interface CreateSessionInput {
  userId: string;
  clientType: AuthClientType;
  authMethods: string[];

  platform?: string;
  deviceLabel?: string;
  userAgentSummary?: string;
  ipAddress?: string;

  // Optional authentication-specific event to persist with session creation.
  securityEvent?: SessionCreationSecurityEvent;
}

export type AuthSessionContext = Pick<
  CreateSessionInput,
  "clientType" | "platform" | "deviceLabel" | "userAgentSummary" | "ipAddress"
>;

/**
 * Public session representation.
 *
 * Never expose internal network metadata, refresh-token records,
 * or other sensitive session properties through session-management APIs.
 */
export type SessionSummary = Pick<
  AuthSession,
  | "id"
  | "clientType"
  | "deviceLabel"
  | "createdAt"
  | "lastSeenAt"
  | "idleExpiresAt"
  | "absoluteExpiresAt"
> & {
  isCurrent: boolean;
};

/**
 * Initial session lifetime configuration.
 *
 * The idle timeout controls inactivity.
 * The absolute lifetime puts a fixed upper limit on a session,
 * regardless of how frequently its credentials are refreshed.
 */
const IDLE_TIMEOUT_MS = env.SESSION_IDLE_TIMEOUT_SECONDS * 1000;

const ABSOLUTE_TIMEOUT_MS = env.SESSION_ABSOLUTE_TIMEOUT_SECONDS * 1000;

if (ABSOLUTE_TIMEOUT_MS < IDLE_TIMEOUT_MS) {
  throw new Error(
    "Session absolute lifetime must be greater than or equal to its idle timeout",
  );
}

/**
 * Normalizes optional device metadata before persistence.
 *
 * Device information is descriptive only. It must not be treated as
 * proof of device identity or used as an authorization factor.
 */
function normalizeMetadata(
  value: string | undefined,
  maxLength: number,
): string | null {
  if (!value) {
    return null;
  }

  const normalized = value
    .trim()
    .replace(/[\r\n\t]/g, " ")
    .slice(0, maxLength);

  return normalized || null;
}

export class SessionService {
  constructor(
    private readonly repository: SessionRepository = sessionRepository,
    private readonly refreshRepository: RefreshTokenRepository = refreshTokenRepository,
  ) {}

  /**
   * Converts a database session into the public API representation.
   *
   * Keeping this mapping centralized prevents internal session fields
   * from accidentally leaking through different API endpoints.
   */
  private toSessionSummary(
    session: AuthSession,
    currentSessionId: string,
  ): SessionSummary {
    return {
      id: session.id,
      clientType: session.clientType,
      deviceLabel: session.deviceLabel,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      idleExpiresAt: session.idleExpiresAt,
      absoluteExpiresAt: session.absoluteExpiresAt,
      isCurrent: session.id === currentSessionId,
    };
  }

  /**
   * Creates an authenticated session and its initial refresh credential.
   *
   * The raw refresh token is returned only to the caller.
   * PostgreSQL receives and stores only its SHA-256 digest.
   *
   * An optional authentication event is recorded in the same transaction
   * as session creation and initial refresh-token persistence.
   */
  public async createSession(
    input: CreateSessionInput,
  ): Promise<{ session: AuthSession; refreshToken: string }> {
    const authMethods = [
      ...new Set(
        input.authMethods
          .map((method) => method.trim().toLowerCase())
          .filter(Boolean),
      ),
    ];

    if (authMethods.length === 0) {
      throw new Error("At least one authentication method is required");
    }

    const now = new Date();

    const absoluteExpiresAt = new Date(now.getTime() + ABSOLUTE_TIMEOUT_MS);

    const idleExpiresAt = new Date(
      Math.min(now.getTime() + IDLE_TIMEOUT_MS, absoluteExpiresAt.getTime()),
    );

    const ipAddress = normalizeMetadata(input.ipAddress, 64);

    const deviceLabel =
      normalizeMetadata(input.deviceLabel, 100) ??
      (input.clientType === "web" ? "Web browser" : "Native application");

    // Generate a cryptographically secure, opaque refresh credential.
    const refreshToken = randomBytes(32).toString("hex");

    // Persist only the digest; the raw credential must never enter the DB.
    const tokenHash = createHash("sha256").update(refreshToken).digest("hex");

    const session = await this.repository.createWithInitialRefreshToken(
      {
        userId: input.userId,
        clientType: input.clientType,

        platform: normalizeMetadata(input.platform, 50),
        deviceLabel,
        userAgentSummary: normalizeMetadata(input.userAgentSummary, 512),

        firstIp: ipAddress,
        lastIp: ipAddress,

        authTime: now,
        authMethods,
        assuranceLevel: 1,

        createdAt: now,
        lastSeenAt: now,
        lastRefreshAt: null,

        idleExpiresAt,
        absoluteExpiresAt,

        revokedAt: null,
        revokeReason: null,
      },
      {
        tokenHash,
        issuedAt: now,
        expiresAt: idleExpiresAt,
      },
      input.securityEvent,
    );

    return { session, refreshToken };
  }

  /**
   * Checks whether an access token's associated session is still valid.
   *
   * A session is rejected when it has been revoked, has exceeded either
   * expiry limit, or belongs to a suspended or banned account.
   */
  public async isSessionValidForAccess(
    sessionId: string,
    userId: string,
  ): Promise<boolean> {
    const result = await this.repository.findForAccessValidation(
      sessionId,
      userId,
    );

    if (!result) {
      return false;
    }

    const { session, accountStatus } = result;
    const now = Date.now();

    return (
      !session.revokedAt &&
      session.idleExpiresAt.getTime() > now &&
      session.absoluteExpiresAt.getTime() > now &&
      accountStatus !== "suspended" &&
      accountStatus !== "banned"
    );
  }

  /**
   * Lists the authenticated user's active sessions.
   *
   * The current session is identified for the frontend, allowing the user
   * to distinguish the browser or device they are currently using.
   */
  public async listUserSessions(
    userId: string,
    currentSessionId: string,
  ): Promise<SessionSummary[]> {
    const sessions = await this.repository.findActiveForUser(
      userId,
      new Date(),
    );

    return sessions.map((session) =>
      this.toSessionSummary(session, currentSessionId),
    );
  }

  /**
   * Retrieves one session belonging to the authenticated user.
   *
   * The repository checks ownership using both session ID and user ID.
   * A session belonging to another account must never be returned.
   */
  public async getUserSession(
    userId: string,
    sessionId: string,
    currentSessionId: string,
  ): Promise<SessionSummary | null> {
    const session = await this.repository.findByIdForUser(sessionId, userId);

    if (!session) {
      return null;
    }

    return this.toSessionSummary(session, currentSessionId);
  }

  /**
   * Revokes one session belonging to the authenticated user.
   *
   * Returns false when the session does not exist or does not belong
   * to the supplied user. The controller can use one consistent
   * response for both cases to avoid exposing session ownership.
   */
  public async revokeUserSession(
    userId: string,
    sessionId: string,
    reason = "user_revoked_session",
  ): Promise<boolean> {
    return this.repository.revokeSessionForUser(
      sessionId,
      userId,
      new Date(),
      reason,
    );
  }

  /**
   * Revokes every other active session while preserving the current one.
   *
   * The current session ID is supplied by the authenticated request,
   * not accepted from the request body.
   */
  public async revokeOtherUserSessions(
    userId: string,
    currentSessionId: string,
    reason = "user_revoked_other_sessions",
  ): Promise<number> {
    return this.repository.revokeOtherSessionsForUser(
      userId,
      currentSessionId,
      new Date(),
      reason,
    );
  }

  /**
   * Revokes other sessions as part of an existing database transaction.
   *
   * The current authenticated session remains active.
   */
  public async revokeOtherUserSessionsInTransaction(
    tx: RefreshTokenTransaction,
    userId: string,
    currentSessionId: string,
    now: Date,
    reason = "user_revoked_other_sessions",
  ): Promise<number> {
    return this.repository.revokeOtherSessionsForUserInTransaction(
      tx,
      userId,
      currentSessionId,
      now,
      reason,
    );
  }

  /**
   * Rotates an opaque refresh credential.
   *
   * The raw credential is hashed before it reaches the repository.
   * A replacement credential is returned only when rotation succeeds.
   */
  public async rotateRefreshToken(rawRefreshToken: string): Promise<
    | {
        outcome: "rotated";
        refreshToken: string;
        sessionId: string;
        userId: string;
        role: string;
      }
    | { outcome: "reused" }
    | { outcome: "invalid" }
    | { outcome: "inactive" }
  > {
    // Refresh credentials are 32 random bytes encoded as 64 hex characters.
    if (!/^[a-f0-9]{64}$/i.test(rawRefreshToken)) {
      return { outcome: "invalid" };
    }

    const replacementToken = randomBytes(32).toString("hex");

    const tokenHash = createHash("sha256")
      .update(rawRefreshToken)
      .digest("hex");

    const replacementTokenHash = createHash("sha256")
      .update(replacementToken)
      .digest("hex");

    const result = await this.refreshRepository.rotate({
      tokenHash,
      replacementTokenHash,
      now: new Date(),
      idleTimeoutMs: IDLE_TIMEOUT_MS,
    });

    if (result.outcome !== "rotated") {
      return result;
    }

    return {
      outcome: "rotated",
      refreshToken: replacementToken,
      sessionId: result.sessionId,
      userId: result.userId,
      role: result.role,
    };
  }

  /**
   * Revokes the session associated with a refresh credential.
   *
   * Invalid credentials are ignored so logout can remain best-effort.
   */
  public async revokeRefreshToken(
    rawRefreshToken: string,
    reason = "user_logout",
  ): Promise<void> {
    if (!/^[a-f0-9]{64}$/i.test(rawRefreshToken)) {
      return;
    }

    const tokenHash = createHash("sha256")
      .update(rawRefreshToken)
      .digest("hex");

    await this.refreshRepository.revokeByTokenHash(
      tokenHash,
      new Date(),
      reason,
    );
  }

  /**
   * Revokes every active database-backed session for an account.
   *
   * The optional actor session identifies the session initiating a
   * user-requested revocation. System-initiated operations can omit it.
   */
  public async revokeAllUserSessions(
    userId: string,
    reason = "account_wide_revocation",
    actorSessionId?: string,
  ): Promise<void> {
    await this.refreshRepository.revokeAllForUser(
      userId,
      new Date(),
      reason,
      actorSessionId,
    );
  }

  /**
   * Revokes all sessions inside an existing database transaction.
   *
   * Used when session invalidation must commit atomically with another
   * authentication operation, such as password reset.
   */
  public async revokeAllUserSessionsInTransaction(
    tx: RefreshTokenTransaction,
    userId: string,
    now: Date,
    reason = "account_wide_revocation",
    actorSessionId?: string,
  ): Promise<void> {
    await this.refreshRepository.revokeAllForUserInTransaction(
      tx,
      userId,
      now,
      reason,
      actorSessionId,
    );
  }
}

export const sessionService = new SessionService();
