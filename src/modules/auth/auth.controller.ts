import { Request, Response, NextFunction } from "express";
import { authService } from "./auth.service";
import { ApiResponse } from "@shared/utils/api-response";
import { AppError } from "@shared/utils/app.error";
import type { AuthSessionContext } from "../sessions/session.service";
import { HTTP_STATUS } from "@shared/constants/http-codes";
import { RegisterInput } from "./dtos/register.dto";
import { LoginInput } from "./dtos/login.dto";
import { VerifyOtpInput } from "./dtos/verify-otp.dto";
import {
  ForgotPasswordInput,
  ResetPasswordInput,
} from "./dtos/password-reset.dto";
import env from "@config/env";

// Cookie Config (HttpOnly)
const isProd = process.env.NODE_ENV === "production";

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? ("none" as const) : ("lax" as const),
  path: "/",
  maxAge: env.SESSION_IDLE_TIMEOUT_SECONDS * 1000,
};

type EmptyParams = Record<string, never>;

/**
 * Returns a verified provider email.
 * Prefer the primary address when multiple verified addresses exist.
 */
function getVerifiedOAuthEmail(emails: unknown): string | undefined {
  if (!Array.isArray(emails)) {
    return undefined;
  }

  const verifiedEmails: Array<{
    value: string;
    primary: boolean;
  }> = [];

  for (const item of emails) {
    if (typeof item !== "object" || item === null) {
      continue;
    }

    const candidate = item as Record<string, unknown>;

    if (candidate.verified !== true || typeof candidate.value !== "string") {
      continue;
    }

    const value = candidate.value.trim();

    if (value.length > 0) {
      verifiedEmails.push({
        value,
        primary: candidate.primary === true,
      });
    }
  }

  return (
    verifiedEmails.find((email) => email.primary)?.value ??
    verifiedEmails[0]?.value
  );
}

/**
 * Extracts descriptive client metadata for the durable session record.
 *
 * Client metadata is supplied by the client and must never be treated
 * as proof of device identity or as an authorization factor.
 *
 * Existing clients default to web for backward compatibility.
 */
function getAuthSessionContext(req: Request): AuthSessionContext {
  const requestedClientType = req.get("x-client-type")?.trim().toLowerCase();

  if (
    requestedClientType &&
    requestedClientType !== "web" &&
    requestedClientType !== "native"
  ) {
    throw new AppError(
      HTTP_STATUS.BAD_REQUEST,
      "Invalid client type. Expected web or native.",
    );
  }

  return {
    clientType: requestedClientType === "native" ? "native" : "web",
    platform:
      req.get("x-client-platform") ||
      req.get("sec-ch-ua-platform") ||
      undefined,
    deviceLabel: req.get("x-device-label") || undefined,
    userAgentSummary: req.get("user-agent") || undefined,
    ipAddress: req.ip || req.socket.remoteAddress || undefined,
  };
}

export class AuthController {
  public async register(
    req: Request<EmptyParams, unknown, RegisterInput>,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const result = await authService.initiateRegistration(req.body);
      new ApiResponse(res, HTTP_STATUS.OK, result.message, null).send();
    } catch (error) {
      next(error);
    }
  }

  // 2. Verify OTP & Create User
  public async verifyEmail(
    req: Request<EmptyParams, unknown, VerifyOtpInput>,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { email, otp } = req.body;
      const sessionContext = getAuthSessionContext(req);

      const { user, accessToken, refreshToken } =
        await authService.verifyRegistration(email, otp, sessionContext);

      const responseData: {
        user: typeof user;
        accessToken: string;
        refreshToken?: string;
      } = {
        user,
        accessToken,
      };

      if (sessionContext.clientType === "web") {
        res.cookie("refreshToken", refreshToken, REFRESH_COOKIE_OPTIONS);
      } else {
        // Native clients must receive the opaque credential to store
        // in platform-secure storage such as Android Keystore-backed storage.
        responseData.refreshToken = refreshToken;
      }

      new ApiResponse(
        res,
        HTTP_STATUS.CREATED,
        "Registration successful",
        responseData,
      ).send();
    } catch (error) {
      next(error);
    }
  }

  // 3. Login
  public async login(
    req: Request<EmptyParams, unknown, LoginInput>,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const sessionContext = getAuthSessionContext(req);
      const ip = sessionContext.ipAddress ?? "Unknown IP";

      const { user, accessToken, refreshToken } = await authService.login(
        req.body,
        ip,
        sessionContext,
      );

      const responseData: {
        user: typeof user;
        accessToken: string;
        refreshToken?: string;
      } = {
        user,
        accessToken,
      };

      if (sessionContext.clientType === "web") {
        res.cookie("refreshToken", refreshToken, REFRESH_COOKIE_OPTIONS);
      } else {
        responseData.refreshToken = refreshToken;
      }

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Login successful",
        responseData,
      ).send();
    } catch (error) {
      next(error);
    }
  }

  // 4. Refresh Token
  public async refreshToken(req: Request, res: Response, next: NextFunction) {
    try {
      const sessionContext = getAuthSessionContext(req);

      const cookies = req.cookies as Record<string, string> | undefined;
      const body = req.body as Record<string, unknown> | undefined;

      const cookieRefreshToken = cookies?.refreshToken;
      const bodyRefreshToken =
        typeof body?.refreshToken === "string" ? body.refreshToken : undefined;

      // Prefer the credential appropriate to the declared client type.
      const refreshToken =
        sessionContext.clientType === "native"
          ? bodyRefreshToken || cookieRefreshToken
          : cookieRefreshToken || bodyRefreshToken;

      if (!refreshToken) {
        new ApiResponse(
          res,
          HTTP_STATUS.UNAUTHORIZED,
          "Refresh Token required",
          null,
        ).send();
        return;
      }

      const tokens = await authService.refreshToken(refreshToken);

      const responseData: {
        accessToken: string;
        refreshToken?: string;
      } = {
        accessToken: tokens.accessToken,
      };

      if (sessionContext.clientType === "web") {
        res.cookie("refreshToken", tokens.refreshToken, REFRESH_COOKIE_OPTIONS);
      } else {
        responseData.refreshToken = tokens.refreshToken;
      }

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Token refreshed",
        responseData,
      ).send();
    } catch (error) {
      next(error);
    }
  }

  // 5. Logout
  // 5. Logout
  public async logout(req: Request, res: Response, next: NextFunction) {
    try {
      const sessionContext = getAuthSessionContext(req);

      // Safely read a refresh token from an untrusted object.
      const readRefreshToken = (source: unknown): string | undefined => {
        if (
          typeof source !== "object" ||
          source === null ||
          !("refreshToken" in source)
        ) {
          return undefined;
        }

        const token = source.refreshToken;

        return typeof token === "string" && token.length > 0
          ? token
          : undefined;
      };

      // Prefer the credential appropriate to the declared client type.
      const cookieRefreshToken = readRefreshToken(req.cookies as unknown);
      const bodyRefreshToken = readRefreshToken(req.body as unknown);

      const refreshToken =
        sessionContext.clientType === "native"
          ? bodyRefreshToken || cookieRefreshToken
          : cookieRefreshToken || bodyRefreshToken;

      if (refreshToken) {
        await authService.logout(refreshToken);
      }

      // Clear the browser's refresh-token cookie.
      if (sessionContext.clientType === "web") {
        res.clearCookie("refreshToken", {
          httpOnly: true,
          secure: isProd,
          sameSite: isProd ? "none" : "lax",
          path: "/",
        });
      }

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Logged out successfully",
        null,
      ).send();
    } catch (error) {
      next(error);
    }
  }

  public async forgotPassword(
    req: Request<EmptyParams, unknown, ForgotPasswordInput>,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const result = await authService.forgotPassword(req.body.email);
      new ApiResponse(res, HTTP_STATUS.OK, result.message, null).send();
    } catch (error) {
      next(error);
    }
  }

  public async resetPassword(
    req: Request<EmptyParams, unknown, ResetPasswordInput>,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { token, password } = req.body;
      await authService.resetPassword(token, password);

      new ApiResponse(
        res,
        HTTP_STATUS.OK,
        "Password reset successfully",
        null,
      ).send();
    } catch (error) {
      next(error);
    }
  }

  public async googleCallback(req: Request, res: Response, next: NextFunction) {
    try {
      const driverUser = req.user;

      if (!driverUser) {
        res.redirect(`${env.CLIENT_URL}/auth/failed`);
        return;
      }

      const email = getVerifiedOAuthEmail(driverUser.emails);

      if (!email) {
        res.redirect(
          `${env.CLIENT_URL}/auth/failed?reason=verified_email_required`,
        );
        return;
      }

      const sessionContext = getAuthSessionContext(req);

      if (sessionContext.clientType !== "web") {
        throw new AppError(
          HTTP_STATUS.BAD_REQUEST,
          "Native OAuth authentication is not supported by this callback yet.",
        );
      }

      const profile = {
        provider: "google" as const,
        providerId: driverUser.id,
        email,
        displayName: driverUser.displayName || "Unknown User",
        picture: driverUser.photos?.[0]?.value,
      };

      const { refreshToken } = await authService.googleAuth(
        profile,
        sessionContext,
      );

      res.cookie("refreshToken", refreshToken, REFRESH_COOKIE_OPTIONS);

      res.redirect(`${env.CLIENT_URL}/auth/success`);
    } catch (error) {
      next(error);
    }
  }

  public async githubCallback(req: Request, res: Response, next: NextFunction) {
    try {
      const driverUser = req.user;

      if (!driverUser) {
        res.redirect(`${env.CLIENT_URL}/auth/failed`);
        return;
      }

      const email = getVerifiedOAuthEmail(driverUser.emails);

      if (!email) {
        res.redirect(
          `${env.CLIENT_URL}/auth/failed?reason=verified_email_required`,
        );
        return;
      }

      const sessionContext = getAuthSessionContext(req);

      if (sessionContext.clientType !== "web") {
        throw new AppError(
          HTTP_STATUS.BAD_REQUEST,
          "Native OAuth authentication is not supported by this callback yet.",
        );
      }

      const profile = {
        provider: "github" as const,
        providerId: driverUser.id,
        email,
        displayName:
          driverUser.displayName || driverUser.username || "GitHub User",
        picture: driverUser.photos?.[0]?.value,
      };

      const { refreshToken } = await authService.githubAuth(
        profile,
        sessionContext,
      );

      res.cookie("refreshToken", refreshToken, REFRESH_COOKIE_OPTIONS);

      res.redirect(`${env.CLIENT_URL}/auth/success`);
    } catch (error) {
      next(error);
    }
  }
}

export const authController = new AuthController();
