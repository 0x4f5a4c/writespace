import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import { authService } from "../../../../src/modules/auth/auth.service";
import { db } from "../../../../src/db";
import { AppError } from "../../../../src/shared/utils/app.error";

// ============================================================
// MOCK EXTERNAL LIBRARIES
// ============================================================

jest.mock("bcryptjs", () => ({
  __esModule: true,
  default: {
    compare: jest.fn(),
    hash: jest.fn(),
  },
}));

jest.mock("jsonwebtoken", () => ({
  __esModule: true,
  default: {
    sign: jest.fn(),
    verify: jest.fn(),
  },
}));

// ============================================================
// MOCK DATABASE
// ============================================================

jest.mock("../../../../src/db", () => {
  const mockLimit = jest.fn();
  const mockReturning = jest.fn();

  return {
    __esModule: true,

    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: mockLimit,
          }),
        }),
      }),

      insert: () => ({
        values: () => ({
          returning: mockReturning,
        }),
      }),

      update: () => ({
        set: () => ({
          where: () => ({
            returning: mockReturning,
          }),
        }),
      }),

      __mockLimit: mockLimit,
      __mockReturning: mockReturning,
    },
  };
});

// ============================================================
// MOCK NOTIFICATION SERVICE
// ============================================================

jest.mock("../../../../src/modules/notification/notification.service", () => ({
  notificationService: {
    sendLoginAlert: jest.fn(),
    sendWelcomeEmail: jest.fn(),
    sendOtpEmail: jest.fn(),
    sendPasswordResetEmail: jest.fn(),
    sendPasswordUpdateEmail: jest.fn(),
  },
}));

// ============================================================
// MOCK REDIS
// ============================================================

jest.mock("../../../../src/config/redis", () => ({
  client: {
    set: jest.fn(),
    get: jest.fn(),
    getDel: jest.fn(),
    del: jest.fn(),
    scanIterator: jest.fn(),
  },

  redisClient: {
    set: jest.fn(),
    get: jest.fn(),
    getDel: jest.fn(),
    del: jest.fn(),
    scanIterator: jest.fn(),
  },
}));

// ============================================================
// TYPED MOCK REFERENCES
// ============================================================

const mockBcryptCompare = bcrypt.compare as jest.Mock<() => Promise<boolean>>;

const mockBcryptHash = bcrypt.hash as jest.Mock<() => Promise<string>>;

const mockJwtSign = jwt.sign as jest.Mock<() => string>;

const mockJwtVerify = jwt.verify as jest.Mock<() => unknown>;

const redis = (
  jest.requireMock("../../../../src/config/redis") as {
    client: {
      set: jest.Mock<() => Promise<unknown>>;
      get: jest.Mock<() => Promise<string | null>>;
      getDel: jest.Mock<() => Promise<string | null>>;
      del: jest.Mock<() => Promise<number>>;
      scanIterator: jest.Mock;
    };
  }
).client;

const mockLimit = (
  db as unknown as {
    __mockLimit: jest.Mock<() => Promise<unknown[]>>;
  }
).__mockLimit;

const mockReturning = (
  db as unknown as {
    __mockReturning: jest.Mock<() => Promise<unknown[]>>;
  }
).__mockReturning;

// ============================================================
// TESTS
// ============================================================

describe("AuthService Unit Tests", () => {
  const MOCK_IP = "127.0.0.1";

  beforeEach(() => {
    jest.clearAllMocks();

    // Default Redis iterator.
    redis.scanIterator.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        // No keys by default.
      },
    });
  });

  // ==========================================================
  // LOGIN
  // ==========================================================

  describe("login()", () => {
    it("should throw 401 if user does not exist", async () => {
      mockLimit.mockResolvedValueOnce([]);

      await expect(
        authService.login(
          {
            email: "wrong@mail.com",
            password: "Password123!",
          },
          MOCK_IP,
        ),
      ).rejects.toThrow(AppError);
    });

    it("should throw 401 if password is incorrect", async () => {
      const mockUser = {
        id: "user-1",
        username: "testuser",
        email: "test@mail.com",
        passwordHash: "hashed-password",
        role: "user",
        status: "active",
      };

      mockLimit.mockResolvedValueOnce([mockUser]);
      mockBcryptCompare.mockResolvedValueOnce(false);

      await expect(
        authService.login(
          {
            email: "test@mail.com",
            password: "wrong-password",
          },
          MOCK_IP,
        ),
      ).rejects.toThrow(AppError);
    });

    it("should reject a suspended account", async () => {
      const mockUser = {
        id: "user-1",
        username: "testuser",
        email: "test@mail.com",
        passwordHash: "hashed-password",
        role: "user",
        status: "suspended",
      };

      mockLimit.mockResolvedValueOnce([mockUser]);
      mockBcryptCompare.mockResolvedValueOnce(true);

      await expect(
        authService.login(
          {
            email: "test@mail.com",
            password: "correct-password",
          },
          MOCK_IP,
        ),
      ).rejects.toThrow("Your account has been suspended");
    });

    it("should reject a banned account", async () => {
      const mockUser = {
        id: "user-1",
        username: "testuser",
        email: "test@mail.com",
        passwordHash: "hashed-password",
        role: "user",
        status: "banned",
      };

      mockLimit.mockResolvedValueOnce([mockUser]);
      mockBcryptCompare.mockResolvedValueOnce(true);

      await expect(
        authService.login(
          {
            email: "test@mail.com",
            password: "correct-password",
          },
          MOCK_IP,
        ),
      ).rejects.toThrow("Your account has been banned");
    });

    it("should return user and tokens on successful login", async () => {
      const mockUser = {
        id: "user-1",
        username: "testuser",
        email: "test@mail.com",
        passwordHash: "hashed-password",
        role: "user",
        status: "active",
      };

      mockLimit.mockResolvedValueOnce([mockUser]);
      mockBcryptCompare.mockResolvedValueOnce(true);
      mockJwtSign.mockReturnValue("mock-jwt-token");

      const result = await authService.login(
        {
          email: "test@mail.com",
          password: "correct-password",
        },
        MOCK_IP,
      );

      expect(result).toHaveProperty("accessToken", "mock-jwt-token");
      expect(result).toHaveProperty("refreshToken", "mock-jwt-token");

      expect(result.user).toHaveProperty("id", "user-1");
      expect(result.user).toHaveProperty("username", "testuser");

      expect(result.user).not.toHaveProperty("passwordHash");
      expect(result.user).not.toHaveProperty("googleAuth");
      expect(result.user).not.toHaveProperty("githubAuth");

      expect(redis.set).toHaveBeenCalled();
    });
  });

  // ==========================================================
  // REFRESH TOKEN
  // ==========================================================

  describe("refreshToken()", () => {
    it("should reject an invalid refresh JWT", async () => {
      mockJwtVerify.mockImplementation(() => {
        throw new Error("Invalid token");
      });

      await expect(
        authService.refreshToken("invalid-refresh-token"),
      ).rejects.toThrow("Invalid Refresh Token");
    });

    it("should reject a refresh token that is not stored in Redis", async () => {
      mockJwtVerify.mockReturnValue({
        id: "user-1",
        role: "user",
      });

      redis.getDel.mockResolvedValueOnce(null);

      await expect(authService.refreshToken("refresh-token")).rejects.toThrow(
        "Session expired or invalid",
      );

      expect(redis.getDel).toHaveBeenCalledWith(
        "refresh_token:user-1:refresh-token",
      );
    });

    it("should reject refresh for a suspended account", async () => {
      mockJwtVerify.mockReturnValue({
        id: "user-1",
        role: "user",
      });

      redis.getDel.mockResolvedValueOnce("valid");

      mockLimit.mockResolvedValueOnce([
        {
          id: "user-1",
          role: "user",
          status: "suspended",
        },
      ]);

      await expect(authService.refreshToken("refresh-token")).rejects.toThrow(
        "Your account has been suspended",
      );
    });

    it("should reject refresh for a banned account", async () => {
      mockJwtVerify.mockReturnValue({
        id: "user-1",
        role: "user",
      });

      redis.getDel.mockResolvedValueOnce("valid");

      mockLimit.mockResolvedValueOnce([
        {
          id: "user-1",
          role: "user",
          status: "banned",
        },
      ]);

      await expect(authService.refreshToken("refresh-token")).rejects.toThrow(
        "Your account has been banned",
      );
    });

    it("should rotate the refresh token successfully", async () => {
      mockJwtVerify.mockReturnValue({
        id: "user-1",
        role: "user",
      });

      redis.getDel.mockResolvedValueOnce("valid");

      mockLimit.mockResolvedValueOnce([
        {
          id: "user-1",
          role: "user",
          status: "active",
        },
      ]);

      mockJwtSign
        .mockReturnValueOnce("new-access-token")
        .mockReturnValueOnce("new-refresh-token");

      const result = await authService.refreshToken("old-refresh-token");

      expect(redis.getDel).toHaveBeenCalledWith(
        "refresh_token:user-1:old-refresh-token",
      );

      expect(result.accessToken).toBe("new-access-token");
      expect(result.refreshToken).toBe("new-refresh-token");

      expect(redis.set).toHaveBeenCalled();
    });
  });

  // ==========================================================
  // LOGOUT
  // ==========================================================

  describe("logout()", () => {
    it("should remove the refresh token from Redis", async () => {
      mockJwtVerify.mockReturnValue({
        id: "user-1",
        role: "user",
      });

      await authService.logout("refresh-token");

      expect(redis.del).toHaveBeenCalledWith(
        "refresh_token:user-1:refresh-token",
      );
    });

    it("should not throw if the refresh token is invalid", async () => {
      mockJwtVerify.mockImplementation(() => {
        throw new Error("Invalid token");
      });

      await expect(
        authService.logout("invalid-token"),
      ).resolves.toBeUndefined();
    });
  });

  // ==========================================================
  // UPDATE PASSWORD
  // ==========================================================

  describe("updatePassword()", () => {
    it("should reject if user does not exist", async () => {
      mockLimit.mockResolvedValueOnce([]);

      await expect(
        authService.updatePassword("user-1", {
          currentPassword: "OldPassword123!",
          newPassword: "NewPassword123!",
        }),
      ).rejects.toThrow(AppError);
    });

    it("should reject if current password is incorrect", async () => {
      mockLimit.mockResolvedValueOnce([
        {
          id: "user-1",
          passwordHash: "old-hash",
          email: "test@mail.com",
          username: "testuser",
        },
      ]);

      mockBcryptCompare.mockResolvedValueOnce(false);

      await expect(
        authService.updatePassword("user-1", {
          currentPassword: "wrong",
          newPassword: "NewPassword123!",
        }),
      ).rejects.toThrow("Incorrect current password");
    });

    it("should update password and revoke all refresh sessions", async () => {
      mockLimit.mockResolvedValueOnce([
        {
          id: "user-1",
          passwordHash: "old-hash",
          email: "test@mail.com",
          username: "testuser",
        },
      ]);

      mockBcryptCompare.mockResolvedValueOnce(true);
      mockBcryptHash.mockResolvedValueOnce("new-password-hash");

      redis.scanIterator.mockReturnValueOnce({
        async *[Symbol.asyncIterator]() {
          yield "refresh_token:user-1:token-a";
          yield "refresh_token:user-1:token-b";
        },
      });

      const result = await authService.updatePassword("user-1", {
        currentPassword: "OldPassword123!",
        newPassword: "NewPassword123!",
      });

      expect(result.message).toBe("Password updated successfully");

      expect(redis.del).toHaveBeenCalledWith("refresh_token:user-1:token-a");

      expect(redis.del).toHaveBeenCalledWith("refresh_token:user-1:token-b");

      expect(bcrypt.hash).toHaveBeenCalled();
    });
  });

  // ==========================================================
  // RESET PASSWORD
  // ==========================================================

  describe("resetPassword()", () => {
    it("should reject an invalid reset token", async () => {
      redis.get.mockResolvedValueOnce(null);

      await expect(
        authService.resetPassword("invalid-reset-token", "NewPassword123!"),
      ).rejects.toThrow("Reset token expired or invalid");
    });

    it("should reset password and invalidate all sessions", async () => {
      redis.get.mockResolvedValueOnce("user-1");

      mockLimit.mockResolvedValueOnce([
        {
          id: "user-1",
          email: "test@mail.com",
          username: "testuser",
        },
      ]);

      mockBcryptHash.mockResolvedValueOnce("new-password-hash");

      redis.scanIterator.mockReturnValueOnce({
        async *[Symbol.asyncIterator]() {
          yield "refresh_token:user-1:token-a";
          yield "refresh_token:user-1:token-b";
        },
      });

      const result = await authService.resetPassword(
        "reset-token",
        "NewPassword123!",
      );

      expect(result.message).toBe(
        "Password reset successful. Please log in again.",
      );

      expect(redis.get).toHaveBeenCalledWith("password_reset:reset-token");

      expect(redis.del).toHaveBeenCalledWith("password_reset:reset-token");

      expect(redis.del).toHaveBeenCalledWith("refresh_token:user-1:token-a");

      expect(redis.del).toHaveBeenCalledWith("refresh_token:user-1:token-b");
    });
  });

  // ==========================================================
  // FORGOT PASSWORD
  // ==========================================================

  describe("forgotPassword()", () => {
    it("should return a generic response when user does not exist", async () => {
      mockLimit.mockResolvedValueOnce([]);

      const result = await authService.forgotPassword("unknown@mail.com");

      expect(result.message).toBe(
        "If that email exists, a reset link has been sent.",
      );

      expect(redis.set).not.toHaveBeenCalled();
    });

    it("should create a reset token for an existing user", async () => {
      mockLimit.mockResolvedValueOnce([
        {
          id: "user-1",
          username: "testuser",
        },
      ]);

      const result = await authService.forgotPassword("test@mail.com");

      expect(result.message).toBe(
        "If that email exists, a reset link has been sent.",
      );

      expect(redis.set).toHaveBeenCalled();

      expect(redis.set).toHaveBeenCalledWith(
        expect.stringMatching(/^password_reset:/),
        "user-1",
        expect.objectContaining({
          EX: expect.any(Number),
        }),
      );
    });
  });
});
