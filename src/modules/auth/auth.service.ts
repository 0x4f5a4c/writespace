import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "crypto";
import { and, eq, gt, isNull, or } from "drizzle-orm";

import { db } from "../../db";
import { authChallenges, authIdentities, users, type User } from "@db/schema";
import { client as redis } from "@config/redis";
import env from "@config/env";

import { AppError } from "@shared/utils/app.error";
import { HTTP_STATUS } from "@shared/constants/http-codes";

import { notificationService } from "../notification/notification.service";
import {
  sessionService,
  type AuthSessionContext,
} from "../sessions/session.service";
import type { SessionCreationSecurityEvent } from "../sessions/session.repository";

import {
  securityEventRepository,
  SECURITY_EVENT_OUTCOMES,
  SECURITY_EVENT_TYPES,
} from "../sessions/security-event.repository";

import { RegisterInput } from "./dtos/register.dto";
import { LoginInput } from "./dtos/login.dto";
import { generateOTP } from "./auth.utils";
import { IOAuthProfile } from "./interface/auth.interface";

import logger from "@config/logger";
import { PublicUser } from "../users/interface/user.interface";

const ACCESS_TOKEN_EXPIRE = env.JWT_ACCESS_EXPIRE;
const OTP_EXPIRE_SEC = 10 * 60;
const RESET_TOKEN_EXPIRE_SEC = 60 * 60;
const SALT_ROUNDS = 12;

/**
 * Temporary registration data stored in Redis.
 *
 * Never store the user's plaintext password in the registration cache.
 */
type PendingRegistration = Omit<RegisterInput, "password"> & {
  passwordHash: string;
  challengeId: string;
  otpHash: string;
};

function isPendingRegistration(value: unknown): value is PendingRegistration {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.fullname === "string" &&
    typeof candidate.username === "string" &&
    typeof candidate.email === "string" &&
    typeof candidate.passwordHash === "string" &&
    typeof candidate.challengeId === "string" &&
    candidate.challengeId.length > 0 &&
    typeof candidate.otpHash === "string" &&
    /^[a-f0-9]{64}$/i.test(candidate.otpHash)
  );
}

/**
 * Creates a challenge-specific digest for a registration OTP.
 *
 * HMAC prevents a Redis-only data exposure from revealing the OTP through
 * offline guessing. The challenge ID and email bind the digest to one
 * registration attempt.
 */
function createRegistrationOtpDigest(
  challengeId: string,
  email: string,
  otp: string,
): string {
  return createHmac("sha256", Buffer.from(env.AUTH_CHALLENGE_SECRET, "hex"))
    .update(`${challengeId}:${email}:${otp}`)
    .digest("hex");
}

/**
 * Hashes a high-entropy password-reset token before storing it.
 *
 * The raw token is only needed when constructing the email link and verifying
 * the user's submission. The database stores only its SHA-256 digest.
 */
function createPasswordResetTokenDigest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

type AuthPublicUser = Omit<PublicUser, "googleAuth" | "githubAuth">;

function toPublicUser(user: typeof users.$inferSelect): AuthPublicUser {
  // Create a separate object so the original database result remains unchanged.
  const publicFields = { ...user };

  // Remove sensitive authentication and account-management fields.
  Reflect.deleteProperty(publicFields, "passwordHash");
  Reflect.deleteProperty(publicFields, "loginAttempts");
  Reflect.deleteProperty(publicFields, "lockUntil");

  // Authentication provider flags are internal implementation details.
  Reflect.deleteProperty(publicFields, "googleAuth");
  Reflect.deleteProperty(publicFields, "githubAuth");

  return publicFields;
}

class AuthService {
  /**
   * Executes a secondary notification without changing the outcome
   * of an authentication operation that has already succeeded.
   *
   * Email and notification delivery failures are logged for investigation.
   */
  private async runNotificationSafely(
    notificationName: string,
    context: {
      userId?: string;
      email?: string;
    },
    send: () => Promise<void>,
  ): Promise<void> {
    try {
      await send();
    } catch (error) {
      logger.error(`Failed to process ${notificationName}`, {
        ...context,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Starts registration by validating account uniqueness, hashing the
   * password and storing temporary registration data in Redis.
   */
  public async initiateRegistration(data: RegisterInput) {
    const [existingUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(or(eq(users.email, data.email), eq(users.username, data.username)))
      .limit(1);

    if (existingUser) {
      throw new AppError(
        HTTP_STATUS.CONFLICT,
        "Email or Username already exists",
      );
    }

    const otp = generateOTP(6);
    const challengeId = randomUUID();

    const { password, ...registrationFields } = data;
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const registrationData: PendingRegistration = {
      ...registrationFields,
      passwordHash,
      challengeId,
      otpHash: createRegistrationOtpDigest(challengeId, data.email, otp),
    };

    await redis.set(
      `auth:register:${data.email}`,
      JSON.stringify(registrationData),
      { EX: OTP_EXPIRE_SEC },
    );

    await notificationService.sendOtpEmail(data.email, otp);

    return {
      message: "OTP sent to email. Please verify to complete registration.",
    };
  }

  /**
   * Verifies registration OTP and creates the user's account.
   *
   * The user record, password identity and registration security event
   * are created in one transaction.
   */
  public async verifyRegistration(
    email: string,
    otp: string,
    context: Partial<AuthSessionContext> = {},
  ) {
    const registrationKey = `auth:register:${email}`;

    // 1. Read pending registration data.
    const cachedData = await redis.get(registrationKey);

    if (!cachedData) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "OTP expired or invalid");
    }

    // 2. Parse and validate cached registration data.
    let parsedData: unknown;

    try {
      parsedData = JSON.parse(cachedData) as unknown;
    } catch {
      await redis.del(registrationKey);

      throw new AppError(HTTP_STATUS.BAD_REQUEST, "OTP expired or invalid");
    }

    if (!isPendingRegistration(parsedData) || parsedData.email !== email) {
      await redis.del(registrationKey);

      throw new AppError(HTTP_STATUS.BAD_REQUEST, "OTP expired or invalid");
    }

    // 3. Reject an incorrect OTP without consuming the valid one.
    const submittedOtpHash = createRegistrationOtpDigest(
      parsedData.challengeId,
      parsedData.email,
      otp,
    );

    const expectedDigest = Buffer.from(parsedData.otpHash, "hex");
    const submittedDigest = Buffer.from(submittedOtpHash, "hex");

    // Compare fixed-length digests to avoid timing-dependent string comparison.
    if (!timingSafeEqual(expectedDigest, submittedDigest)) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "Invalid OTP");
    }

    // 4. Atomically consume the OTP.
    // Only one concurrent verification request can successfully consume it.
    const consumedData = await redis.getDel(registrationKey);

    if (consumedData !== cachedData) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "OTP expired or invalid");
    }

    // 5. Create the account, password identity and registration event together.
    const user = await db.transaction(async (tx) => {
      const [createdUser] = await tx
        .insert(users)
        .values({
          fullname: parsedData.fullname,
          email: parsedData.email,
          username: parsedData.username,
          passwordHash: parsedData.passwordHash,
        })
        .returning();

      await tx.insert(authIdentities).values({
        userId: createdUser.id,
        provider: "password",
        passwordHash: parsedData.passwordHash,
      });

      // The registration OTP has been successfully verified.
      // Record completion without storing the submitted OTP or password.
      await securityEventRepository.create(tx, {
        userId: createdUser.id,
        sessionId: null,
        eventType: SECURITY_EVENT_TYPES.AUTH_REGISTRATION_COMPLETED,
        outcome: SECURITY_EVENT_OUTCOMES.SUCCESS,
        reason: "email_otp_verified_registration_completed",
        metadata: {
          emailVerified: true,
          authMethod: "password",
        },
        occurredAt: new Date(),
      });

      return createdUser;
    });

    // 6. Create a durable session and issue authentication tokens.
    const tokens = await this.signTokens(
      user.id,
      user.role,
      ["password"],
      context,
    );

    // 7. Send the welcome notification without affecting registration success.
    await this.runNotificationSafely(
      "registration welcome notification",
      {
        userId: user.id,
        email: user.email,
      },
      () =>
        notificationService.sendWelcomeEmail(
          user.email,
          user.username,
          user.id,
        ),
    );

    return {
      user: toPublicUser(user),
      ...tokens,
    };
  }

  /**
   * Authenticates a user through email and password.
   */
  public async login(
    data: LoginInput,
    ip: string,
    context: Partial<AuthSessionContext> = {},
  ) {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, data.email))
      .limit(1);

    if (!user || !user.passwordHash) {
      throw new AppError(HTTP_STATUS.UNAUTHORIZED, "Invalid email or password");
    }

    const passwordMatch = await bcrypt.compare(
      data.password,
      user.passwordHash,
    );

    if (!passwordMatch) {
      throw new AppError(HTTP_STATUS.UNAUTHORIZED, "Invalid email or password");
    }

    this.ensureAccountIsActive(user.status);

    // Create a separate durable session for this successful login.
    // The login event is persisted atomically with the session.
    const tokens = await this.signTokens(
      user.id,
      user.role,
      ["password"],
      {
        ...context,
        ipAddress: context.ipAddress ?? (ip === "Unknown IP" ? undefined : ip),
      },
      {
        eventType: SECURITY_EVENT_TYPES.AUTH_LOGIN,
        outcome: SECURITY_EVENT_OUTCOMES.SUCCESS,
        reason: "password_login",
        metadata: {
          authMethod: "password",
        },
      },
    );

    await this.runNotificationSafely(
      "login alert",
      {
        userId: user.id,
        email: user.email,
      },
      () =>
        notificationService.sendLoginAlert(
          user.email,
          user.username,
          ip,
          user.id,
        ),
    );

    logger.info("User logged in successfully", { userId: user.id });

    return { user: toPublicUser(user), ...tokens };
  }

  public async googleAuth(
    profile: IOAuthProfile,
    context: Partial<AuthSessionContext> = {},
  ) {
    return this.handleSocialAuth(profile, "googleAuth", context);
  }

  public async githubAuth(
    profile: IOAuthProfile,
    context: Partial<AuthSessionContext> = {},
  ) {
    return this.handleSocialAuth(profile, "githubAuth", context);
  }

  /**
   * Handles Google and GitHub authentication using the provider's
   * immutable subject ID as the identity lookup key.
   */
  private async handleSocialAuth(
    profile: IOAuthProfile,
    providerField: "googleAuth" | "githubAuth",
    context: Partial<AuthSessionContext> = {},
  ) {
    const email = profile.email.trim();
    const providerSubject = profile.providerId.trim();

    if (!email || !providerSubject) {
      throw new AppError(
        HTTP_STATUS.UNAUTHORIZED,
        "A verified email address and provider identity are required",
      );
    }

    // The provider's immutable subject ID is the authoritative identity.
    // Email addresses can change, so they must not identify an OAuth account.
    const [existingIdentity] = await db
      .select({ userId: authIdentities.userId })
      .from(authIdentities)
      .where(
        and(
          eq(authIdentities.provider, profile.provider),
          eq(authIdentities.providerSubject, providerSubject),
        ),
      )
      .limit(1);

    if (existingIdentity) {
      const [existingUser] = await db
        .select()
        .from(users)
        .where(eq(users.id, existingIdentity.userId))
        .limit(1);

      if (!existingUser) {
        throw new AppError(
          HTTP_STATUS.UNAUTHORIZED,
          "The linked account could not be found",
        );
      }

      this.ensureAccountIsActive(existingUser.status);

      // Keep the legacy provider flag synchronized during the transition.
      if (!existingUser[providerField]) {
        await db
          .update(users)
          .set({ [providerField]: true })
          .where(eq(users.id, existingUser.id));
      }

      // Record successful OAuth authentication with the new session.
      return this.signTokens(
        existingUser.id,
        existingUser.role,
        [profile.provider],
        context,
        {
          eventType: SECURITY_EVENT_TYPES.AUTH_OAUTH_LOGIN,
          outcome: SECURITY_EVENT_OUTCOMES.SUCCESS,
          reason: "oauth_login",
          metadata: {
            provider: profile.provider,
          },
        },
      );
    }

    // Do not silently link an OAuth identity to an existing account just
    // because their email addresses match. Account linking needs an explicit,
    // authenticated flow that we will implement separately.
    const [existingUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existingUser) {
      throw new AppError(
        HTTP_STATUS.CONFLICT,
        "An account with this email already exists. Sign in using your existing authentication method.",
      );
    }

    const username =
      profile.displayName.toLowerCase().replace(/\s+/g, "") + generateOTP(4);

    // OAuth-only accounts do not receive an artificial password credential.
    // Create the account, provider identity and audit event together.
    const newUser = await db.transaction(async (tx) => {
      const [createdUser] = await tx
        .insert(users)
        .values({
          fullname: profile.displayName,
          email,
          username,
          profileImageUrl: profile.picture || undefined,
          [providerField]: true,
        })
        .returning();

      await tx.insert(authIdentities).values({
        userId: createdUser.id,
        provider: profile.provider,
        providerSubject,
      });

      await securityEventRepository.create(tx, {
        userId: createdUser.id,
        sessionId: null,
        eventType: SECURITY_EVENT_TYPES.AUTH_OAUTH_ACCOUNT_CREATED,
        outcome: SECURITY_EVENT_OUTCOMES.SUCCESS,
        reason: "oauth_account_created",
        metadata: {
          provider: profile.provider,
        },
        occurredAt: new Date(),
      });

      return createdUser;
    });

    await this.runNotificationSafely(
      "OAuth welcome notification",
      {
        userId: newUser.id,
        email: newUser.email,
      },
      () =>
        notificationService.sendWelcomeEmail(
          newUser.email,
          newUser.username,
          newUser.id,
        ),
    );

    return this.signTokens(
      newUser.id,
      newUser.role,
      [profile.provider],
      context,
    );
  }

  /**
   * Rotates an opaque refresh token through the durable session system.
   *
   * The repository handles atomic token consumption, successor creation,
   * session expiry checks, and refresh-token reuse detection.
   */
  public async refreshToken(oldRefreshToken: string) {
    const result = await sessionService.rotateRefreshToken(oldRefreshToken);

    if (result.outcome === "reused") {
      logger.warn("Refresh token reuse detected", {
        event: "refresh_token_reuse",
      });

      throw new AppError(
        HTTP_STATUS.UNAUTHORIZED,
        "Refresh token reuse detected. Please sign in again.",
      );
    }

    if (result.outcome === "inactive") {
      throw new AppError(HTTP_STATUS.FORBIDDEN, "Your account is not active");
    }

    if (result.outcome === "invalid") {
      throw new AppError(
        HTTP_STATUS.UNAUTHORIZED,
        "Session expired or invalid",
      );
    }

    return {
      accessToken: this.createAccessToken(
        result.userId,
        result.role,
        result.sessionId,
      ),
      refreshToken: result.refreshToken,
    };
  }

  /**
   * Revokes the session associated with the supplied refresh credential.
   *
   * Logout remains best-effort so invalid or expired tokens do not prevent
   * the controller from clearing the browser's refresh-token cookie.
   */
  public async logout(refreshToken: string) {
    try {
      await sessionService.revokeRefreshToken(refreshToken, "user_logout");
    } catch (error) {
      logger.warn("Failed to revoke authentication session during logout", {
        error,
      });
    }
  }

  /**
   * Starts the password-reset flow.
   *
   * The raw token is sent through the reset link. Only its SHA-256 digest
   * is persisted in the authentication challenge table.
   */
  public async forgotPassword(email: string) {
    const [user] = await db
      .select({ id: users.id, username: users.username, email: users.email })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user) {
      return { message: "If that email exists, a reset link has been sent." };
    }

    // A 32-byte random token provides 256 bits of entropy.
    // Only its SHA-256 digest is stored in the database.
    const resetToken = randomBytes(32).toString("hex");
    const secretHash = createPasswordResetTokenDigest(resetToken);

    await db.insert(authChallenges).values({
      userId: user.id,
      purpose: "password_reset",
      targetEmail: user.email,
      secretHash,
      expiresAt: new Date(Date.now() + RESET_TOKEN_EXPIRE_SEC * 1000),
    });

    const resetUrl = `${env.CLIENT_URL}/auth/reset-password?token=${resetToken}`;

    await notificationService.sendPasswordResetEmail(
      user.email,
      user.username,
      resetUrl,
    );

    return { message: "If that email exists, a reset link has been sent." };
  }

  /**
   * Resets the user's password and invalidates existing authentication
   * sessions so previously issued credentials cannot remain active.
   *
   * Password updates, reset-challenge consumption, session revocation
   * and security-event recording are committed in one transaction.
   */
  public async resetPassword(token: string, newPassword: string) {
    const secretHash = createPasswordResetTokenDigest(token);

    // Hash before opening the transaction so the database row lock is not
    // held during the relatively expensive password-hashing operation.
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    const now = new Date();

    const user = await db.transaction(async (tx) => {
      // Lock the challenge row so concurrent reset requests cannot both
      // consume the same challenge.
      const [challenge] = await tx
        .select({
          id: authChallenges.id,
          userId: authChallenges.userId,
        })
        .from(authChallenges)
        .where(
          and(
            eq(authChallenges.secretHash, secretHash),
            eq(authChallenges.purpose, "password_reset"),
            isNull(authChallenges.consumedAt),
            isNull(authChallenges.revokedAt),
            gt(authChallenges.expiresAt, now),
          ),
        )
        .for("update")
        .limit(1);

      if (!challenge?.userId) {
        throw new AppError(
          HTTP_STATUS.BAD_REQUEST,
          "Invalid or expired password reset token",
        );
      }

      const [account] = await tx
        .select({
          id: users.id,
          username: users.username,
          email: users.email,
        })
        .from(users)
        .where(eq(users.id, challenge.userId))
        .limit(1);

      if (!account) {
        throw new AppError(
          HTTP_STATUS.BAD_REQUEST,
          "Invalid or expired password reset token",
        );
      }

      // Update the legacy password field and its identity record together.
      await tx
        .update(users)
        .set({ passwordHash })
        .where(eq(users.id, account.id));

      const [passwordIdentity] = await tx
        .update(authIdentities)
        .set({
          passwordHash,
          updatedAt: now,
        })
        .where(
          and(
            eq(authIdentities.userId, account.id),
            eq(authIdentities.provider, "password"),
          ),
        )
        .returning({ id: authIdentities.id });

      if (!passwordIdentity) {
        await tx.insert(authIdentities).values({
          userId: account.id,
          provider: "password",
          passwordHash,
        });
      }

      // Consume the challenge as part of the same transaction.
      await tx
        .update(authChallenges)
        .set({ consumedAt: now })
        .where(eq(authChallenges.id, challenge.id));

      // Revoke all active sessions and their refresh credentials atomically
      // with the password update and reset-challenge consumption.
      await sessionService.revokeAllUserSessionsInTransaction(
        tx,
        account.id,
        now,
        "password_reset",
      );

      // Record the password-reset action even when the account had
      // no active sessions to revoke. SecurityEventRepository also
      // publishes the mandatory notification outbox event.
      await securityEventRepository.create(tx, {
        userId: account.id,
        sessionId: null,
        eventType: SECURITY_EVENT_TYPES.PASSWORD_RESET,
        outcome: SECURITY_EVENT_OUTCOMES.SUCCESS,
        reason: "password_reset_completed",
        metadata: {},
        occurredAt: now,
      });

      return account;
    });

    // Clean up legacy Redis refresh-token keys after the database transaction
    // commits. This is compatibility cleanup for the previous token system.
    await this.clearLegacyRefreshTokens(user.id);

    // The password-reset security alert and its email delivery are now
    // handled by the transactional notification pipeline.
  }

  /**
   * Creates a durable session and returns its initial opaque refresh token
   * together with a session-bound access token.
   *
   * An optional authentication event is persisted atomically with session
   * creation, initial refresh-token persistence and session.created.
   */
  private async signTokens(
    userId: string,
    role: string,
    authMethods: string[],
    context: Partial<AuthSessionContext> = {},
    securityEvent?: SessionCreationSecurityEvent,
  ) {
    const { session, refreshToken } = await sessionService.createSession({
      userId,
      clientType: context.clientType ?? "web",
      authMethods,
      platform: context.platform,
      deviceLabel: context.deviceLabel,
      userAgentSummary: context.userAgentSummary,
      ipAddress: context.ipAddress,
      securityEvent,
    });

    return {
      accessToken: this.createAccessToken(userId, role, session.id),
      refreshToken,
    };
  }

  /**
   * Creates a short-lived access JWT bound to one durable authentication
   * session. The middleware validates that session on authenticated requests.
   */
  private createAccessToken(
    userId: string,
    role: string,
    sessionId: string,
  ): string {
    const accessExpiry = ACCESS_TOKEN_EXPIRE as jwt.SignOptions["expiresIn"];

    return jwt.sign(
      {
        id: userId,
        role,
        sid: sessionId,
      },
      env.JWT_ACCESS_SECRET,
      {
        expiresIn: accessExpiry,
        algorithm: "HS256",
      },
    );
  }

  private ensureAccountIsActive(status: User["status"]): void {
    if (status === "banned") {
      throw new AppError(HTTP_STATUS.FORBIDDEN, "Your account has been banned");
    }

    if (status === "suspended") {
      throw new AppError(
        HTTP_STATUS.FORBIDDEN,
        "Your account has been suspended",
      );
    }
  }

  /**
   * Removes legacy JWT refresh-token keys created before the
   * database-backed session migration.
   *
   * Redis scanIterator yields batches of matching keys. Empty batches
   * must be skipped because Redis DEL requires at least one key.
   */
  private async clearLegacyRefreshTokens(userId: string): Promise<void> {
    for await (const keys of redis.scanIterator({
      MATCH: `refresh_token:${userId}:*`,
      COUNT: 100,
    })) {
      // SCAN may return an empty batch when no matching keys exist.
      if (keys.length === 0) {
        continue;
      }

      // Delete the matching keys in one Redis command.
      await redis.del(keys);
    }
  }

  /**
   * Revokes every durable session belonging to a user and cleans up
   * refresh-token records from the previous authentication implementation.
   */
  public async revokeAllRefreshTokens(userId: string): Promise<void> {
    await sessionService.revokeAllUserSessions(
      userId,
      "account_wide_revocation",
    );

    await this.clearLegacyRefreshTokens(userId);
  }
}

export const authService = new AuthService();
