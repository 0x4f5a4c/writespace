import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

import {
  authenticate,
  authorize,
} from "../../../../src/shared/middlewares/auth.middleware";

// ============================================================
// TEST TYPES
// ============================================================

type MockRequest = Partial<Request> & {
  headers: Record<string, string | undefined>;
  user?: {
    id: string;
    role: string;
  };
};

// ============================================================
// TESTS
// ============================================================

describe("Auth Middlewares", () => {
  let mockReq: MockRequest;
  let mockRes: Partial<Response>;
  let mockNext: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockReq = {
      headers: {},
    };

    mockRes = {
      status: jest.fn().mockReturnThis() as unknown as Response["status"],
      json: jest.fn() as unknown as Response["json"],
    };

    mockNext = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ==========================================================
  // authenticate()
  // ==========================================================

  describe("authenticate()", () => {
    it("should call next() with 401 if authorization header is missing", async () => {
      await authenticate(
        mockReq as Request,
        mockRes as Response,
        mockNext as unknown as NextFunction,
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          message: "No token provided, authorization denied",
        }),
      );
    });

    it("should call next() with 401 if authorization header does not use Bearer scheme", async () => {
      mockReq.headers = {
        authorization: "Basic some-token",
      };

      await authenticate(
        mockReq as Request,
        mockRes as Response,
        mockNext as unknown as NextFunction,
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          message: "No token provided, authorization denied",
        }),
      );
    });

    it("should call next() with 401 if Bearer token is empty", async () => {
      mockReq.headers = {
        authorization: "Bearer   ",
      };

      await authenticate(
        mockReq as Request,
        mockRes as Response,
        mockNext as unknown as NextFunction,
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          message: "No token provided, authorization denied",
        }),
      );
    });

    it("should call next() with 401 if JWT is invalid", async () => {
      mockReq.headers = {
        authorization: "Bearer invalid-token",
      };

      jest.spyOn(jwt, "verify").mockImplementationOnce(() => {
        throw new jwt.JsonWebTokenError("Invalid token");
      });

      await authenticate(
        mockReq as Request,
        mockRes as Response,
        mockNext as unknown as NextFunction,
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          message: "Invalid token",
        }),
      );
    });

    it("should call next() with 401 if JWT is expired", async () => {
      mockReq.headers = {
        authorization: "Bearer expired-token",
      };

      jest.spyOn(jwt, "verify").mockImplementationOnce(() => {
        throw new jwt.TokenExpiredError("Token expired", new Date());
      });

      await authenticate(
        mockReq as Request,
        mockRes as Response,
        mockNext as unknown as NextFunction,
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          message: "Token expired",
        }),
      );
    });

    it("should call next() with 401 if JWT payload is invalid", async () => {
      mockReq.headers = {
        authorization: "Bearer valid-signature-invalid-payload",
      };

      const verifySpy = jest
        .spyOn(jwt, "verify")
        .mockReturnValueOnce({ foo: "bar" } as never);

      await authenticate(
        mockReq as Request,
        mockRes as Response,
        mockNext as unknown as NextFunction,
      );

      expect(verifySpy).toHaveBeenCalledWith(
        "valid-signature-invalid-payload",
        expect.any(String),
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          message: "Invalid token payload",
        }),
      );

      expect(mockReq.user).toBeUndefined();
    });

    it("should attach user to request and call next() if Bearer token is valid", async () => {
      mockReq.headers = {
        authorization: "Bearer valid-token",
      };

      const mockDecodedToken = {
        id: "123",
        role: "user",
      };

      const verifySpy = jest
        .spyOn(jwt, "verify")
        .mockReturnValueOnce(mockDecodedToken as never);

      await authenticate(
        mockReq as Request,
        mockRes as Response,
        mockNext as unknown as NextFunction,
      );

      expect(verifySpy).toHaveBeenCalledWith("valid-token", expect.any(String));

      expect(mockReq.user).toEqual({
        id: "123",
        role: "user",
      });

      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockNext).toHaveBeenCalledWith();
    });
  });

  // ==========================================================
  // authorize()
  // ==========================================================

  describe("authorize()", () => {
    it("should return 403 if user role is not defined", () => {
      const middleware = authorize("admin");

      middleware(
        mockReq as Request,
        mockRes as Response,
        mockNext as unknown as NextFunction,
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 403,
          message: "Access Forbidden: User role not defined",
        }),
      );
    });

    it("should return 403 if user role does not match allowed roles", () => {
      mockReq.user = {
        id: "1",
        role: "user",
      };

      const middleware = authorize("admin");

      middleware(
        mockReq as Request,
        mockRes as Response,
        mockNext as unknown as NextFunction,
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 403,
          message: "Access Forbidden: Insufficient permissions",
        }),
      );
    });

    it("should allow access if user has the required role", () => {
      mockReq.user = {
        id: "1",
        role: "admin",
      };

      const middleware = authorize("admin");

      middleware(
        mockReq as Request,
        mockRes as Response,
        mockNext as unknown as NextFunction,
      );

      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockNext).toHaveBeenCalledWith();
    });

    it("should allow access if user matches any of the allowed roles", () => {
      mockReq.user = {
        id: "1",
        role: "moderator",
      };

      const middleware = authorize("admin", "moderator");

      middleware(
        mockReq as Request,
        mockRes as Response,
        mockNext as unknown as NextFunction,
      );

      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockNext).toHaveBeenCalledWith();
    });
  });
});
