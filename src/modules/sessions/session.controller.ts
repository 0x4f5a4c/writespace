import type { Request, Response, NextFunction } from "express";
import { z } from "zod";

import { sessionService } from "./session.service";

import { ApiResponse } from "@shared/utils/api-response";
import { AppError } from "@shared/utils/app.error";
import { HTTP_STATUS } from "@shared/constants/http-codes";

const sessionIdSchema = z.string().uuid();

/**
 * Keep this configuration aligned with the refresh-token cookie
 * configuration in auth.controller.ts.
 */
const isProd = process.env.NODE_ENV === "production";

function clearRefreshCookie(res: Response): void {
  res.clearCookie("refreshToken", {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    path: "/",
  });
}

/**
 * Extracts the authenticated account and current session.
 *
 * Both values come from authentication middleware, never from
 * request parameters or request bodies.
 */
function getAuthContext(req: Request): {
  userId: string;
  currentSessionId: string;
} {
  if (!req.user?.id || !req.user.sessionId) {
    throw new AppError(HTTP_STATUS.UNAUTHORIZED, "Authentication required.");
  }

  return {
    userId: req.user.id,
    currentSessionId: req.user.sessionId,
  };
}

function getSessionId(req: Request): string {
  const parsed = sessionIdSchema.safeParse(req.params.sessionId);

  if (!parsed.success) {
    throw new AppError(
      HTTP_STATUS.BAD_REQUEST,
      "A valid session ID is required.",
    );
  }

  return parsed.data;
}

function setPrivateNoStore(res: Response): void {
  res.setHeader("Cache-Control", "private, no-store");
}

export class SessionController {
  /**
   * GET /sessions
   *
   * Returns the authenticated user's active sessions.
   * The current session is identified in the response.
   */
  public static async getSessions(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { userId, currentSessionId } = getAuthContext(req);

      const data = await sessionService.listUserSessions(
        userId,
        currentSessionId,
      );

      setPrivateNoStore(res);

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Sessions retrieved successfully.",
        data,
      ).send();
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /sessions/:sessionId
   *
   * Retrieves one session belonging to the authenticated account.
   */
  public static async getSession(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { userId, currentSessionId } = getAuthContext(req);
      const sessionId = getSessionId(req);

      const data = await sessionService.getUserSession(
        userId,
        sessionId,
        currentSessionId,
      );

      if (!data) {
        throw new AppError(HTTP_STATUS.NOT_FOUND, "Session not found.");
      }

      setPrivateNoStore(res);

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Session retrieved successfully.",
        data,
      ).send();
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /sessions/:sessionId
   *
   * Revokes one session belonging to the authenticated account.
   * If the current session is revoked, clear its browser refresh cookie.
   */
  public static async revokeSession(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { userId, currentSessionId } = getAuthContext(req);
      const sessionId = getSessionId(req);

      const revoked = await sessionService.revokeUserSession(
        userId,
        sessionId,
        "user_revoked_session",
      );

      if (!revoked) {
        throw new AppError(HTTP_STATUS.NOT_FOUND, "Session not found.");
      }

      if (sessionId === currentSessionId) {
        clearRefreshCookie(res);
      }

      setPrivateNoStore(res);

      new ApiResponse(res, HTTP_STATUS.OK, "Session revoked successfully.", {
        sessionId,
        revoked: true,
      }).send();
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /sessions/revoke-others
   *
   * Revokes all other sessions while preserving the current session.
   */
  public static async revokeOtherSessions(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { userId, currentSessionId } = getAuthContext(req);

      const revokedCount = await sessionService.revokeOtherUserSessions(
        userId,
        currentSessionId,
        "user_revoked_other_sessions",
      );

      setPrivateNoStore(res);

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Other sessions revoked successfully.",
        { revokedCount },
      ).send();
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /sessions/revoke-all
   *
   * Revokes every session belonging to the authenticated account,
   * including the current session.
   *
   * The current browser refresh-token cookie is cleared afterwards.
   */
  public static async revokeAllSessions(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { userId, currentSessionId } = getAuthContext(req);

      await sessionService.revokeAllUserSessions(
        userId,
        "user_revoked_all_sessions",
        currentSessionId,
      );

      clearRefreshCookie(res);
      setPrivateNoStore(res);

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "All sessions revoked successfully.",
        { revoked: true },
      ).send();
    } catch (error) {
      next(error);
    }
  }
}
