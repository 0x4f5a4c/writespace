import type { Request, Response, NextFunction } from "express";

import env from "@config/env";
import { HTTP_STATUS } from "@shared/constants/http-codes";
import { AppError } from "@shared/utils/app.error";

// Compare origins rather than complete URLs, because the frontend URL may
// contain a path while browser Origin headers contain only scheme and host.
const TRUSTED_CLIENT_ORIGIN = new URL(env.CLIENT_URL).origin;

/**
 * Checks whether a request contains the refresh-token cookie.
 *
 * Native clients can submit their refresh token explicitly in the request
 * body, so they do not rely on browser cookie authentication.
 */
function hasRefreshTokenCookie(req: Request): boolean {
  const cookies: unknown = req.cookies;

  if (typeof cookies !== "object" || cookies === null) {
    return false;
  }

  return Object.prototype.hasOwnProperty.call(cookies, "refreshToken");
}

/**
 * Resolves the request origin from Origin, falling back to Referer.
 *
 * An explicitly supplied Origin takes precedence. An invalid or untrusted
 * Origin must never be overridden by a trusted Referer.
 */
function getRequestOrigin(req: Request): string | undefined {
  const origin = req.get("origin");
  const referer = req.get("referer");

  const candidate = origin ?? referer;

  if (!candidate) {
    return undefined;
  }

  try {
    return new URL(candidate).origin;
  } catch {
    return undefined;
  }
}

/**
 * Protects cookie-authenticated endpoints against cross-site request forgery.
 *
 * Requests using an HttpOnly refresh-token cookie must come from the
 * configured frontend origin. Native clients using an explicitly supplied
 * refresh token in the request body are not subject to browser-origin checks.
 */
export function requireTrustedOriginForCookieAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (!hasRefreshTokenCookie(req)) {
    next();
    return;
  }

  const requestOrigin = getRequestOrigin(req);

  if (requestOrigin !== TRUSTED_CLIENT_ORIGIN) {
    next(new AppError(HTTP_STATUS.FORBIDDEN, "Untrusted request origin"));
    return;
  }

  next();
}
