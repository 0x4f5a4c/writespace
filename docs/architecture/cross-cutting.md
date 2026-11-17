---
description: Cross-cutting architectural patterns in Writespace, including structured logging, error envelopes, authentication, rate limiting, concurrency locks, and caching headers.
---

# Cross-Cutting Concerns

> **Purpose:** Document the shared rules and middlewares that apply across all Writespace modules: logging, error handling, auth/CSRF, rate limiting, validation, concurrency locking, and HTTP caching.
> **Audience:** Internal backend developers.
> **Prerequisites:** Read [Component Breakdown (C4 L3)](components.md).

## Overview

Rather than re-implementing logging, error formatting, rate limiting, or concurrency guards inside each feature module, Writespace centralizes cross-cutting concerns in `src/config/` and `src/shared/` and enforces consistent transaction/locking patterns across all repositories.

## 1. Logging (`src/config/logger.ts` & `http-logger.middleware.ts`)

Application logging is configured in `src/config/logger.ts` using `zario` (`^0.7.0`):

- **Environment-aware formatting:**
  - `NODE_ENV === "development"`: Level `debug`, `colorize: true`, `json: false`, prefix `[WriteSpace]`.
  - `NODE_ENV !== "development"`: Level `info`, `colorize: false`, `json: true`, prefix `[WriteSpace]`.
- **Dual transports:** Logs are written to both `ConsoleTransport` (`stdout`/`stderr`) and `FileTransport` at `logs/combined.log` (`maxSize: 10 * 1024 * 1024` [10 MB], `maxFiles: 5`).
- **HTTP request logging:** `src/shared/middlewares/http-logger.middleware.ts` pipes `morgan` (`:method :url :status :res[content-length] - :response-time ms`) into `logger.info`.
- **Credential redaction in error strings:** When persisting dispatch errors to `outbox_events.last_error`, `getErrorMessage` in `src/modules/notification/services/outbox-dispatcher.service.ts` strips database and Redis connection credentials using `/(redis|rediss|postgres|postgresql):\/\/[^@\s]+@/gi` → `"$1://[REDACTED]@"`.

## 2. Response & error envelopes (`api-response.ts`, `app.error.ts`, `error.middleware.ts`)

Every controller uses `ApiResponse<T>` (`src/shared/utils/api-response.ts`) for successful responses and throws `AppError` (`src/shared/utils/app.error.ts`) for operational errors, which are caught by `errorHandler` (`src/shared/middlewares/error.middleware.ts`):

| Case                                | HTTP Status                    | JSON Shape                                                                                    | Source                                                 |
| :---------------------------------- | :----------------------------- | :-------------------------------------------------------------------------------------------- | :----------------------------------------------------- |
| **Success (`200–299`)**             | `200` / `201`                  | `{ success: true, statusCode, message, data, timestamp }`                                     | `src/shared/utils/api-response.ts`                     |
| **Operational `AppError`**          | `err.statusCode` (`4xx`/`5xx`) | `{ success: false, message, stack? }`                                                         | `src/shared/utils/app.error.ts`, `error.middleware.ts` |
| **`ZodError` (Validation)**         | `400 Bad Request`              | `{ success: false, message: "Validation failed", errors: err.flatten(), stack? }`             | `src/shared/middlewares/error.middleware.ts`           |
| **Rate Limit Exceeded**             | `429 Too Many Requests`        | `{ success: false, message, data: null }`                                                     | `src/shared/middlewares/rate-limit.middleware.ts`      |
| **PG `23505` (Unique Violation)**   | `409 Conflict`                 | `{ success: false, message: "Resource already exists", stack? }`                              | `src/shared/middlewares/error.middleware.ts`           |
| **PG `23503` (FK Violation)**       | `400 Bad Request`              | `{ success: false, message: "Referenced resource does not exist", stack? }`                   | `src/shared/middlewares/error.middleware.ts`           |
| **PG `23502` (Not-Null Violation)** | `400 Bad Request`              | `{ success: false, message: "Required field is missing", stack? }`                            | `src/shared/middlewares/error.middleware.ts`           |
| **PG `22P02` (Invalid Text Rep)**   | `400 Bad Request`              | `{ success: false, message: "Invalid data format", stack? }`                                  | `src/shared/middlewares/error.middleware.ts`           |
| **Unhandled Error**                 | `500 Internal Server Error`    | `{ success: false, message: "Internal Server Error" \| "Database operation failed", stack? }` | `src/shared/middlewares/error.middleware.ts`           |

{% hint style="info" %}
**Stack trace exposure rule:** `error.middleware.ts` includes `response.stack` **only** when `env.NODE_ENV === "development"`.
{% endhint %}

## 3. Authentication, RBAC & CSRF protection

- **Access token + live session check (`src/shared/middlewares/auth.middleware.ts`):** `authenticate` verifies the `Bearer <token>` header with `jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ["HS256"] })`, checks that `id` and `sid` match `UUID_REGEX` and `role` is `"user"` or `"admin"`, and awaits `sessionService.isSessionValidForAccess(decoded.sid, decoded.id)`.
- **Role-based access control (`authorize`):** `authorize(...allowedRoles)` checks `req.user?.role` and returns `403 Forbidden` if missing or not in `allowedRoles`.
- **Trusted-origin CSRF check for cookie auth (`src/shared/middlewares/trusted-origin.middleware.ts`):** Applied to `POST /api/v1/auth/refresh-token` and `POST /api/v1/auth/logout`. Whenever `req.cookies.refreshToken` is present, `requireTrustedOriginForCookieAuth` compares `new URL(origin ?? referer).origin` against `new URL(env.CLIENT_URL).origin`, rejecting mismatches with `403 Forbidden` (`"Untrusted request origin"`).

## 4. Redis-backed rate limiting (`src/shared/middlewares/rate-limit.middleware.ts`)

All 10 rate limiters store counters in Redis (`rate-limit-redis` with `passOnStoreError: false`, `standardHeaders: true`, `legacyHeaders: false`). Sensitive authentication endpoints layer **an IP limiter before Zod validation** and **an email limiter (using `sha256(normalizedEmail)`) after Zod validation** (`src/modules/auth/auth.routes.ts`):

| Route / Scope                       | IP Limiter (`rl:<prefix>:`)               | Email Limiter (`rl:<prefix>:email:<sha256>`)                | `skipSuccessfulRequests` |
| :---------------------------------- | :---------------------------------------- | :---------------------------------------------------------- | :----------------------- |
| `/api/v1/*` (Global)                | `api`: `300` req / `15m` (`900000ms`)     | None                                                        | `false`                  |
| `POST /api/v1/auth/login`           | `login`: `10` failed / `15m`              | `login-email`: `5` failed / `15m`                           | `true`                   |
| `POST /api/v1/auth/register`        | `register`: `10` req / `1h` (`3600000ms`) | `register-email`: `3` req / `1h`                            | `false`                  |
| `POST /api/v1/auth/verify-email`    | `email-verification`: `10` failed / `15m` | `email-verification-email`: `5` failed / `10m` (`600000ms`) | `true`                   |
| `POST /api/v1/auth/forgot-password` | `forgot-password`: `5` req / `1h`         | `forgot-password-email`: `3` req / `1h`                     | `false`                  |
| `POST /api/v1/auth/reset-password`  | `reset-password`: `10` failed / `15m`     | None                                                        | `true`                   |

## 5. Concurrency control & row-locking order

To prevent deadlocks and lost updates when multiple requests or workers mutate related rows concurrently, Writespace enforces strict locking discipline:

| Operation                                           | Lock Strategy & Ordering                                                                                                                                              | Source File                                                                                |
| :-------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------- |
| **Post / Article Update**                           | Optimistic concurrency: `UPDATE content_items SET version = version + 1 WHERE id = :id AND version = :expectedVersion`                                                | `post-command.service.ts`, `article-command.service.ts`                                    |
| **Follow / Unfollow / Toggle & Notification Check** | Lock both `users` rows in ascending UUID order (`ORDER BY users.id ASC FOR UPDATE`) before locking or mutating `follows`                                              | `src/modules/interactions/repositories/follow.repository.ts`, `notification.repository.ts` |
| **Content / Comment Reactions & Comments**          | Lock parent `content_items` row (`FOR UPDATE`) **before** locking child `comments`, `content_reactions`, or `comment_reactions` rows                                  | `reaction.repository.ts`, `comment.repository.ts`, `notification.repository.ts`            |
| **Session Bulk Revocation & Password Change**       | Lock `users` row (`FOR UPDATE`) **before** locking active `auth_sessions` rows (`FOR UPDATE`)                                                                         | `session.repository.ts`, `refresh-token.repository.ts`, `user.service.ts`                  |
| **Notification Grouping**                           | Lock active `notification_groups` row (`FOR UPDATE`) then active `notifications` presentation row (`FOR UPDATE`), with 3-attempt retry loop on unique constraint race | `src/modules/notification/repositories/notification-group.repository.ts`                   |
| **Delivery Claim & Lease Renewal**                  | Lock `notification_deliveries` row (`FOR UPDATE`), read PostgreSQL `clock_timestamp()`, then lock `notification_delivery_attempts` (`FOR UPDATE`)                     | `src/modules/notification/repositories/notification-delivery.repository.ts`                |

## 6. HTTP `Cache-Control` policies

| Endpoint Group                                                                        | `Cache-Control` Header                                         | Source File                                                                                    |
| :------------------------------------------------------------------------------------ | :------------------------------------------------------------- | :--------------------------------------------------------------------------------------------- |
| `/api/v1/notifications/*`, `/api/v1/notification-preferences/*`, `/api/v1/sessions/*` | `private, no-store`                                            | `notification.controller.ts`, `notification-preference.controller.ts`, `session.controller.ts` |
| `GET /api/v1/posts/public/:id/preview`, `GET /api/v1/articles/public/:slug/preview`   | `public, max-age=60, s-maxage=300, stale-while-revalidate=600` | `posts.controller.ts`, `articles.controller.ts`                                                |
| `GET /api/v1/users/og/:username`                                                      | `public, max-age=86400`                                        | `src/modules/users/user.controller.ts`                                                         |

## Key decisions & rationale

- **Why `passOnStoreError: false` in `rate-limit.middleware.ts`?** Failing closed when Redis is unreachable prevents brute-force login, OTP verification, or password-reset attacks from bypassing rate limiters during a Redis hiccup.
- **Why lock `users` in `ASC` ID order during follow operations?** If User A follows User B at the same instant User B follows User A, locking `(followerId, followingId)` in parameter order would deadlock. Ordering `WHERE id IN (A, B) ORDER BY id ASC FOR UPDATE` (`follow.repository.ts`, `notification.repository.ts`) guarantees a deterministic global lock acquisition order.

## Gotchas & edge cases

- **`validate.middleware.ts` overwrites `req.body` only:** In `src/shared/middlewares/validate.middleware.ts`, `schema.parse({ body: req.body, query: req.query, params: req.params })` assigns `req.body = parsed.body`, but leaves `req.query` and `req.params` as their original Express objects (in Express 5, `req.query` is a getter). Controllers that need coerced query values parse `req.query` directly (for example, `inboxQuerySchema.safeParse(req.query)` in `notification.controller.ts`).
- **Controller-level `safeParse` vs. route-level `validate(Schema)`:** `PostsController` and `ArticlesController` run `CreatePostSchema.safeParse` / `UpdatePostSchema.safeParse` inside the controller method, while `posts.routes.ts` and `articles.routes.ts` _also_ register `validate(CreatePostSchema)` / `validate(UpdatePostSchema)` in the route middleware chain. Keep both aligned if modifying Post or Article DTOs.

## Related

- [Component Breakdown (C4 L3)](components.md)
- [Error Envelope & Status Codes](../api/errors.md)
- [Rate Limiting & Origin Security Controls](../api/rate-limits.md)
- [Transactional Services & Locking](../backend/services.md)

---

_Last verified against: v1.0.0 (12bc4d7, documentation branch, 2026-11-17)_
