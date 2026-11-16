import { createHash, randomBytes, timingSafeEqual } from "crypto";
import type { Request } from "express";
import type OAuth2Strategy from "passport-oauth2";

import { client as redis } from "@config/redis";

const STATE_TTL_SECONDS = 5 * 60;
const STATE_TTL_MS = STATE_TTL_SECONDS * 1000;

type StoreCallback = OAuth2Strategy.StateStoreStoreCallback;
type VerifyCallback = OAuth2Strategy.StateStoreVerifyCallback;

type OAuthProvider = "google" | "github";

/**
 * Hashes state values before using them in Redis keys.
 */
function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Compares fixed-length hexadecimal digests without timing-dependent
 * string comparison.
 */
function safelyCompareDigests(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) {
    return false;
  }

  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error("OAuth state operation failed");
}

/**
 * Redis-backed OAuth state protection.
 *
 * Each authorization request receives:
 * - A random state value sent to the OAuth provider.
 * - A separate random browser-binding cookie.
 *
 * Redis stores the state digest and browser-binding digest together.
 * The callback must present both the original state and its browser cookie.
 *
 * No express-session dependency is required.
 */
export class RedisOAuthStateStore implements OAuth2Strategy.StateStore {
  private readonly cookiePrefix: string;

  private readonly secureCookies = process.env.NODE_ENV === "production";

  constructor(private readonly provider: OAuthProvider) {
    this.cookiePrefix = `oauth_state_${provider}`;
  }

  private redisKey(state: string): string {
    return `oauth:state:${this.provider}:${hashValue(state)}`;
  }

  private cookieName(state: string): string {
    // A separate cookie per state allows multiple OAuth flows in different
    // browser tabs without overwriting one another's browser binding.
    return `${this.cookiePrefix}_${state}`;
  }

  private cookieAttributes() {
    return {
      httpOnly: true,
      secure: this.secureCookies,
      sameSite: "lax" as const,
      path: "/",
    };
  }

  private async createState(req: Request): Promise<string> {
    const response = req.res;

    if (!response) {
      throw new Error("OAuth response is unavailable");
    }

    const state = randomBytes(32).toString("hex");
    const browserBinding = randomBytes(32).toString("hex");

    const result = await redis.set(
      this.redisKey(state),
      hashValue(browserBinding),
      {
        EX: STATE_TTL_SECONDS,
        NX: true,
      },
    );

    if (result !== "OK") {
      throw new Error("Unable to create OAuth authorization state");
    }

    response.cookie(this.cookieName(state), browserBinding, {
      ...this.cookieAttributes(),
      maxAge: STATE_TTL_MS,
    });

    return state;
  }

  private async consumeState(
    req: Request,
    providedState: string,
  ): Promise<boolean> {
    const response = req.res;

    if (!response) {
      return false;
    }

    if (!/^[a-f0-9]{64}$/i.test(providedState)) {
      return false;
    }

    const cookies: unknown = req.cookies;

    if (typeof cookies !== "object" || cookies === null) {
      return false;
    }

    const cookieName = this.cookieName(providedState);
    const browserBinding = (cookies as Record<string, unknown>)[cookieName];

    if (
      typeof browserBinding !== "string" ||
      !/^[a-f0-9]{64}$/i.test(browserBinding)
    ) {
      return false;
    }

    const key = this.redisKey(providedState);

    const storedBindingHash = await redis.get(key);

    if (!storedBindingHash) {
      return false;
    }

    const submittedBindingHash = hashValue(browserBinding);

    if (!safelyCompareDigests(storedBindingHash, submittedBindingHash)) {
      return false;
    }

    // Atomically consume the state so a callback cannot be replayed.
    const consumedBindingHash = await redis.getDel(key);

    if (
      !consumedBindingHash ||
      !safelyCompareDigests(storedBindingHash, consumedBindingHash)
    ) {
      return false;
    }

    response.clearCookie(cookieName, this.cookieAttributes());

    return true;
  }

  // Passport selects this overload using the method's runtime arity.
  store(req: Request, callback: StoreCallback): void;

  store(
    req: Request,
    meta: OAuth2Strategy.Metadata,
    callback: StoreCallback,
  ): void;

  // Keep exactly three parameters in this implementation.
  // passport-oauth2@1.8.0 checks store.length to select this signature.
  store(
    req: Request,
    metaOrCallback: OAuth2Strategy.Metadata | StoreCallback,
    callback?: StoreCallback,
  ): void {
    const done =
      typeof metaOrCallback === "function" ? metaOrCallback : callback;

    if (!done) {
      throw new Error("OAuth state store callback is missing");
    }

    void this.createState(req)
      .then((state) => done(null, state))
      .catch((error: unknown) => done(normalizeError(error), undefined));
  }

  verify(req: Request, state: string, callback: VerifyCallback): void;

  verify(
    req: Request,
    state: string,
    meta: OAuth2Strategy.Metadata,
    callback: VerifyCallback,
  ): void;

  // Keep exactly four parameters in this implementation.
  // passport-oauth2@1.8.0 checks verify.length to select this signature.
  verify(
    req: Request,
    state: string,
    metaOrCallback: OAuth2Strategy.Metadata | VerifyCallback,
    callback?: VerifyCallback,
  ): void {
    const done =
      typeof metaOrCallback === "function" ? metaOrCallback : callback;

    if (!done) {
      throw new Error("OAuth state verification callback is missing");
    }

    void this.consumeState(req, state)
      .then((valid) => {
        if (!valid) {
          done(null, false, {
            message: "Invalid or expired OAuth authorization state",
          });
          return;
        }

        done(null, true, undefined);
      })
      .catch((error: unknown) => {
        done(normalizeError(error), false, undefined);
      });
  }
}
