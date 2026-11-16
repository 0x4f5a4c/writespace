import { eq, and, ilike, or } from "drizzle-orm";
import { db } from "../../db";
import { users, type User } from "../../db/schema/users";
import { follows } from "../../db/schema/follows";
import { authIdentities } from "../../db/schema/auth-identities";
import bcrypt from "bcryptjs";
import { authService } from "../auth/auth.service";
import type { UpdatePasswordInput } from "./dtos/update-password.dto";
import { AppError } from "@shared/utils/app.error";
import { HTTP_STATUS } from "@shared/constants/http-codes";
import type { UpdateProfileDto } from "./dtos/update-profile.dto";
import type { PublicUser, PublicProfile } from "./interface/user.interface";

import { sessionService } from "../sessions/session.service";
import {
  securityEventRepository,
  SECURITY_EVENT_OUTCOMES,
  SECURITY_EVENT_TYPES,
} from "../sessions/security-event.repository";

const SALT_ROUNDS = 12;

import { notificationService } from "../notification/notification.service";

export interface UsernameAvailability {
  available: boolean;
  suggestions?: string[];
}

export class UserService {
  private static toPublicUser(user: User): PublicUser {
    // Keep the original database record unchanged.
    const publicFields = { ...user };

    // Remove sensitive authentication and account-management fields.
    Reflect.deleteProperty(publicFields, "passwordHash");
    Reflect.deleteProperty(publicFields, "loginAttempts");
    Reflect.deleteProperty(publicFields, "lockUntil");
    Reflect.deleteProperty(publicFields, "googleAuth");
    Reflect.deleteProperty(publicFields, "githubAuth");

    return publicFields as PublicUser;
  }

  public static async checkUsernameAvailability(
    username: string,
  ): Promise<UsernameAvailability> {
    const normalizedUsername = username.trim().toLowerCase();

    if (!normalizedUsername) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "Username cannot be empty");
    }

    const existing = await db.query.users.findFirst({
      where: eq(users.username, normalizedUsername),
      columns: { id: true },
    });

    if (!existing) return { available: true };

    const suggestions: string[] = [];
    for (let i = 0; i < 15 && suggestions.length < 3; i++) {
      const candidate = `${normalizedUsername}${Math.floor(Math.random() * 900) + 100}`;
      const isTaken = await db.query.users.findFirst({
        where: eq(users.username, candidate),
        columns: { id: true },
      });
      if (!isTaken) suggestions.push(candidate);
    }

    return { available: false, suggestions };
  }

  /**
   * Search users by username or fullname
   */
  public static async searchUsers(query: string, limitCount = 5) {
    if (!query || query.trim() === "") return [];

    const searchPattern = `%${query}%`;

    const results = await db.query.users.findMany({
      where: and(
        eq(users.status, "active"),
        or(
          ilike(users.username, searchPattern),
          ilike(users.fullname, searchPattern),
        ),
      ),
      columns: {
        id: true,
        username: true,
        fullname: true,
        profileImageUrl: true,
        headline: true,
      },
      limit: limitCount,
    });

    return results;
  }

  public static async getUserProfile(
    username: string,
    currentUserId: string,
  ): Promise<PublicProfile & { isFollowingByMe: boolean }> {
    const normalizedUsername = username.trim().toLowerCase();

    const user = await db.query.users.findFirst({
      where: and(
        eq(users.username, normalizedUsername),
        eq(users.status, "active"),
      ),
      columns: {
        id: true,
        fullname: true,
        username: true,
        bio: true,
        headline: true,
        location: true,
        profileImageUrl: true,
        bannerImageUrl: true,

        youtube: true,
        instagram: true,
        facebook: true,
        twitter: true,
        github: true,
        website: true,
        linkedin: true,
        leetcode: true,
        geeksforgeeks: true,
        codeforces: true,

        totalPosts: true,
        totalReads: true,
        totalFollowers: true,
        totalFollowing: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "User not found");
    }

    let isFollowingByMe = false;

    if (currentUserId !== user.id) {
      const [followRecord] = await db
        .select({ followerId: follows.followerId })
        .from(follows)
        .where(
          and(
            eq(follows.followerId, currentUserId),
            eq(follows.followingId, user.id),
          ),
        )
        .limit(1);

      isFollowingByMe = Boolean(followRecord);
    }

    return {
      ...user,
      isFollowingByMe,
    };
  }

  public static async getMe(userId: string): Promise<PublicUser> {
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user)
      throw new AppError(HTTP_STATUS.NOT_FOUND, "User session invalid");
    return this.toPublicUser(user);
  }

  public static async updateUser(
    userId: string,
    updateData: UpdateProfileDto,
    mediaPaths?: {
      profileImage?: { url: string; publicId: string };
      bannerImage?: { url: string; publicId: string };
    },
  ): Promise<PublicUser> {
    const sanitized: Partial<User> = {};
    let isCriticalUpdate = false;

    // 1. Extract Personal Info
    if (updateData.personal_info) {
      const { fullname, bio, headline, location } = updateData.personal_info;

      if (fullname !== undefined) {
        sanitized.fullname = fullname;
        isCriticalUpdate = true; // Name change warrants an email
      }

      if (bio !== undefined) sanitized.bio = bio;
      if (headline !== undefined) sanitized.headline = headline;
      if (location !== undefined) sanitized.location = location;
    }

    // 2. Extract Social Links
    if (updateData.social_links) {
      const {
        website,
        github,
        twitter,
        linkedin,
        instagram,
        youtube,
        facebook,
        leetcode,
        geeksforgeeks,
        codeforces,
      } = updateData.social_links;
      if (website !== undefined) sanitized.website = website;
      if (github !== undefined) sanitized.github = github;
      if (twitter !== undefined) sanitized.twitter = twitter;
      if (linkedin !== undefined) sanitized.linkedin = linkedin;
      if (instagram !== undefined) sanitized.instagram = instagram;
      if (youtube !== undefined) sanitized.youtube = youtube;
      if (facebook !== undefined) sanitized.facebook = facebook;
      if (leetcode !== undefined) sanitized.leetcode = leetcode;
      if (geeksforgeeks !== undefined) sanitized.geeksforgeeks = geeksforgeeks;
      if (codeforces !== undefined) sanitized.codeforces = codeforces;
    }

    // 3. Extract Media Paths (Cloudinary)
    if (mediaPaths?.profileImage) {
      sanitized.profileImageUrl = mediaPaths.profileImage.url;
      sanitized.profileImagePublicId = mediaPaths.profileImage.publicId;
    }

    if (mediaPaths?.bannerImage) {
      sanitized.bannerImageUrl = mediaPaths.bannerImage.url;
      sanitized.bannerImagePublicId = mediaPaths.bannerImage.publicId;
    }

    if (Object.keys(sanitized).length === 0) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "No valid fields provided for update",
      );
    }

    const [updated] = await db
      .update(users)
      .set({ ...sanitized, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();

    if (!updated)
      throw new AppError(HTTP_STATUS.NOT_FOUND, "User not found during update");

    if (isCriticalUpdate) {
      notificationService
        .sendProfileUpdateEmail(updated.email, updated.username)
        .catch((err) =>
          console.error("Failed to send profile update email:", err),
        );
    }

    return this.toPublicUser(updated);
  }

  /**
   * Changes the password of an authenticated user.
   *
   * The user must provide the current password before a new password
   * can be saved. Other sessions are revoked while the current session
   * remains active.
   *
   * Password updates, session revocation and security events are
   * committed in one transaction.
   */
  public static async updatePassword(
    userId: string,
    currentSessionId: string,
    data: UpdatePasswordInput,
  ): Promise<{ message: string }> {
    const [user] = await db
      .select({
        id: users.id,
        passwordHash: users.passwordHash,
        email: users.email,
        username: users.username,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user || !user.passwordHash) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "User not found or uses social login without a password.",
      );
    }

    const isMatch = await bcrypt.compare(
      data.currentPassword,
      user.passwordHash,
    );

    if (!isMatch) {
      throw new AppError(
        HTTP_STATUS.UNAUTHORIZED,
        "Incorrect current password",
      );
    }

    const newPasswordHash = await bcrypt.hash(data.newPassword, SALT_ROUNDS);
    const now = new Date();

    await db.transaction(async (tx) => {
      // Lock the account and check that its password was not changed
      // by another request after the current-password verification.
      const [lockedUser] = await tx
        .select({
          id: users.id,
          passwordHash: users.passwordHash,
        })
        .from(users)
        .where(eq(users.id, userId))
        .for("update");

      if (!lockedUser || lockedUser.passwordHash !== user.passwordHash) {
        throw new AppError(
          HTTP_STATUS.CONFLICT,
          "Your password has changed. Please try again.",
        );
      }

      // Keep the legacy user record and password identity synchronized.
      await tx
        .update(users)
        .set({ passwordHash: newPasswordHash })
        .where(eq(users.id, userId));

      const [passwordIdentity] = await tx
        .update(authIdentities)
        .set({
          passwordHash: newPasswordHash,
          updatedAt: now,
        })
        .where(
          and(
            eq(authIdentities.userId, userId),
            eq(authIdentities.provider, "password"),
          ),
        )
        .returning({ id: authIdentities.id });

      // Support transitional accounts without a password identity record.
      if (!passwordIdentity) {
        await tx.insert(authIdentities).values({
          userId,
          provider: "password",
          passwordHash: newPasswordHash,
        });
      }

      // Revoke every other session and its refresh credentials.
      // The authenticated current session remains active.
      await sessionService.revokeOtherUserSessionsInTransaction(
        tx,
        userId,
        currentSessionId,
        now,
        "password_changed",
      );

      // Record the password change atomically with the update.
      // This also creates the mandatory security notification outbox event.
      await securityEventRepository.create(tx, {
        userId,
        sessionId: currentSessionId,
        eventType: SECURITY_EVENT_TYPES.PASSWORD_CHANGED,
        outcome: SECURITY_EVENT_OUTCOMES.SUCCESS,
        reason: "authenticated_password_change",
        metadata: {},
        occurredAt: now,
      });
    });

    // The password-changed security alert and email are now handled
    // by the transactional notification pipeline.

    return {
      message:
        "Password updated successfully. Other sessions have been signed out.",
    };
  }

  /**
   * Suspends an account and revokes all associated authentication sessions.
   *
   * The account status change, session revocation and security audit event
   * are committed in one database transaction.
   */
  public static async deleteUser(userId: string): Promise<void> {
    const now = new Date();

    await db.transaction(async (tx) => {
      // Lock the account before changing its status or revoking its sessions.
      const [account] = await tx
        .select({
          id: users.id,
          status: users.status,
        })
        .from(users)
        .where(eq(users.id, userId))
        .for("update");

      if (!account) {
        throw new AppError(HTTP_STATUS.NOT_FOUND, "User not found");
      }

      const isNewSuspension = account.status !== "suspended";

      await tx
        .update(users)
        .set({ status: "suspended" })
        .where(eq(users.id, userId));

      // Revoke all sessions and refresh credentials in this transaction.
      await sessionService.revokeAllUserSessionsInTransaction(
        tx,
        userId,
        now,
        "account_suspended",
      );

      // Avoid duplicate account-suspension events for repeated requests.
      if (isNewSuspension) {
        await securityEventRepository.create(tx, {
          userId,
          sessionId: null,
          eventType: SECURITY_EVENT_TYPES.ACCOUNT_SUSPENDED,
          outcome: SECURITY_EVENT_OUTCOMES.SUCCESS,
          reason: "account_suspended",
          metadata: {},
          occurredAt: now,
        });
      }
    });

    // Preserve cleanup of refresh-token keys from the previous Redis-based
    // authentication implementation. Database revocation has already
    // completed atomically above.
    try {
      await authService.revokeAllRefreshTokens(userId);
    } catch (error) {
      console.error("Failed to clean up legacy refresh tokens:", {
        userId,
        error,
      });
    }
  }

  /**
   * Extremely fast, raw DB query used specifically for generating Open Graph Images.
   */
  public static async getRawUserDataForOgImage(username: string) {
    const user = await db.query.users.findFirst({
      where: eq(users.username, username),
      columns: {
        username: true,
        fullname: true,
        headline: true,
        profileImageUrl: true,
      },
    });

    if (!user) {
      throw new AppError(
        HTTP_STATUS.NOT_FOUND,
        "User not found for OG generation",
      );
    }

    return user;
  }
}
