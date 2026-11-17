---
description: How Writespace loads, validates, and overrides environment configuration across local Node.js, Docker Compose, and production profiles.
---

# Configuration & Environment Profiles

> **Purpose:** Explain how environment configuration is loaded and validated in `src/config/env.ts`, and how local Node.js, Docker Compose, and production profiles differ.
> **Audience:** Internal developers and operations maintainers.
> **Prerequisites:** Read [Installation & Local Setup](installation.md).

## Overview

Writespace centralizes runtime configuration in `src/config/env.ts` using `dotenv` and a strict Zod schema (`envSchema`). When the server starts, `envSchema.safeParse(process.env)` validates types, coerces numeric and boolean strings, applies defaults, and enforces cross-field constraints. If validation fails, the process prints the structured Zod error to `stderr` (`Invalid environment variables:`) and terminates immediately with `process.exit(1)`.

> **Note:** `PORT` defaults to `8000` in all environments. This was previously inconsistent (code defaulted to `3000` while tooling used `8000`) and was corrected. Anyone with an old `.env` that relied on the `3000` default should set `PORT` explicitly.

## Configuration profiles comparison

Writespace operates across three primary configuration profiles depending on how the process is launched:

| Setting / Aspect          | Native Node.js (`.env`)                                                    | Docker Compose Dev (`docker-compose.yml`)                 | Production (`docker-compose.prod.yml`)                                |
| :------------------------ | :------------------------------------------------------------------------- | :-------------------------------------------------------- | :-------------------------------------------------------------------- |
| **Env File Loaded**       | `.env` via `dotenv.config()` (`src/config/env.ts`)                         | `.env` + `environment:` overrides in `docker-compose.yml` | `.env.production` (`env_file:` in `docker-compose.prod.yml`)          |
| **`NODE_ENV`**            | `development`                                                              | `development`                                             | `production`                                                          |
| **`PORT`**                | `8000`                                                                     | `8000` (mapped to `127.0.0.1:${HOST_PORT:-8000}:8000`)    | `8000` (mapped to `127.0.0.1:${HOST_PORT:-8000}:8000`)                |
| **`DATABASE_URL`**        | Host URL (e.g. `localhost:5433` or `localhost:5432`)                       | Overridden to `postgresql://...@postgres:5432/writespace` | Supplied via `.env.production`                                        |
| **`DATABASE_DIRECT_URL`** | Host URL (used by `drizzle.config.ts`)                                     | Overridden to `postgresql://...@postgres:5432/writespace` | Supplied via `.env.production`                                        |
| **`REDIS_URL`**           | Host URL (e.g. `redis://localhost:6380` or `6379`)                         | Overridden to `redis://redis:6379`                        | Supplied via `.env.production`                                        |
| **`TRUST_PROXY_HOPS`**    | `0`                                                                        | Overridden to `0`                                         | Set to `1` behind host Nginx reverse proxy                            |
| **Refresh Cookie Policy** | `secure: false`, `sameSite: "lax"` (`auth.controller.ts`)                  | `secure: false`, `sameSite: "lax"`                        | `secure: true`, `sameSite: "none"` (`isProd` in `auth.controller.ts`) |
| **Logger Format**         | Colorized console (`debug` level) + file (`src/config/logger.ts`)          | Colorized console (`debug` level) + `./logs` volume       | JSON (`info` level) + `api_logs` volume                               |
| **Error Stack Traces**    | Included in HTTP error JSON (`src/shared/middlewares/error.middleware.ts`) | Included in HTTP error JSON                               | Omitted from HTTP responses                                           |

## Cross-field invariants enforced at startup

Beyond individual variable types, `src/config/env.ts`, `src/config/bullmq.ts`, and `src/modules/sessions/session.service.ts` enforce five cross-field and structural invariants when the application boots:

1. **PostgreSQL Pool Bounds (`src/config/env.ts`):** `DB_POOL_MIN <= DB_POOL_MAX` (defaults: `min=2`, `max=10`). Violating this fails Zod validation with `"DB_POOL_MIN cannot be greater than DB_POOL_MAX"`.
2. **Outbox Backoff Bounds (`src/config/env.ts`):** `OUTBOX_DISPATCHER_BACKOFF_MAX_MS >= OUTBOX_DISPATCHER_BACKOFF_BASE_MS` (defaults: `base=1000`, `max=60000`).
3. **Session Timeout Bounds (`src/modules/sessions/session.service.ts`):** `SESSION_ABSOLUTE_TIMEOUT_SECONDS * 1000 >= SESSION_IDLE_TIMEOUT_SECONDS * 1000` (defaults: `idle=604800` [7 days], `absolute=2592000` [30 days]). Violating this throws `"Session absolute lifetime must be greater than or equal to its idle timeout"` at module load.
4. **Challenge Secret Entropy (`src/config/env.ts`):** `AUTH_CHALLENGE_SECRET` must match `/^[a-fA-F0-9]{64}$/` (32 bytes / 256 bits hex-encoded) for HMAC-SHA256 OTP digests (`src/modules/auth/auth.service.ts`).
5. **Redis Protocol & DB Index (`src/config/bullmq.ts`):** `REDIS_URL` must use `redis:` or `rediss:` protocol and a non-negative safe integer pathname (defaults to DB `0`). When `rediss:` is used, `bullmqRedisConnection` automatically enables `{ tls: {} }`.

## Enabling the durable notification & outbox pipeline

`OUTBOX_PROCESSING_ENABLED` is a boolean feature flag (`"true"` or `"false"`, defaulting to `"false"` in `src/config/env.ts`) that controls both sides of the durable notification architecture:

- **Domain producers:** `PostCommandService`, `ArticleCommandService`, `CommentService`, `ReactionService`, `FollowService`, and `SaveService` check `env.OUTBOX_PROCESSING_ENABLED` before recording domain events in `outbox_events`. (Note: `SecurityEventRepository` in `src/modules/sessions/security-event.repository.ts` always records `auth.security_alert` outbox rows when an allowlisted security event occurs.)
- **Background workers (`src/server.ts`):** Only when `env.OUTBOX_PROCESSING_ENABLED` is `true` does `src/server.ts` initialize `notificationEventsQueue`, `notificationDeliveryEventsQueue`, `notificationEventsWorker`, `notificationDeliveryEventsWorker`, `notificationReconciliationWorker`, and `outboxDispatcherWorker`.

{% hint style="warning" %}
**Pending `.env.example` update:** `OUTBOX_PROCESSING_ENABLED` and its 7 companion outbox/delivery lease variables are defined and validated in `src/config/env.ts` but are not yet listed in `.env.example` (they will be added in a follow-up repository change). Add `OUTBOX_PROCESSING_ENABLED=true` to your `.env` after running migrations to activate the notification pipeline locally. See [Environment Variables](../reference/env-vars.md) for all 8 variables and their defaults.
{% endhint %}

## Key decisions & rationale

- **Separate `CLIENT_URL` and `SERVER_URL`:** `CLIENT_URL` (`http://localhost:5173`) governs CORS (`src/app.ts`), Socket.IO CORS (`notification-socket.server.ts`), CSRF origin verification (`trusted-origin.middleware.ts`), OAuth post-login redirects (`auth.controller.ts`), and canonical share/email links. `SERVER_URL` (`http://localhost:8000/api/v1`) constructs OAuth2 callback URLs (`${env.SERVER_URL}/auth/google/callback` and `/auth/github/callback` in `src/modules/auth/auth.utils.ts`).

- **Explicit proxy hop configuration (`TRUST_PROXY_HOPS`):** `app.set("trust proxy", env.TRUST_PROXY_HOPS)` in `src/app.ts` ensures `req.ip` (used by `express-rate-limit` and session audit logging) cannot be spoofed via `X-Forwarded-For` headers when `TRUST_PROXY_HOPS=0` in local development, while allowing accurate client IP extraction when set to `1` behind a single reverse proxy in production.

## Gotchas & edge cases

- **`Cookie` `SameSite=None; Secure` in production:** When `NODE_ENV=production`, `REFRESH_COOKIE_OPTIONS` in `src/modules/auth/auth.controller.ts` sets `secure: true` and `sameSite: "none"`. If you test a `NODE_ENV=production` build over plain `http://localhost` without TLS, browsers will reject the `refreshToken` cookie.

- **Drizzle Kit reads `.env` directly:** `drizzle.config.ts` imports `"dotenv/config"` directly rather than importing `src/config/env.ts`. It requires `DATABASE_DIRECT_URL` to be set in your environment or `.env` file.

## Related

- [Environment Variables](../reference/env-vars.md)
- [Configuration Files](../reference/config-files.md)
- [Environments (Local vs. OCI Single-VM)](../operations/environments.md)

---

_Last verified against: v1.0.0 (12bc4d7, documentation branch, 2026-11-17)_
