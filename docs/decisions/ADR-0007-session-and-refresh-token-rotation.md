---
description: Why Writespace validates access JWTs against PostgreSQL auth_sessions and rotates SHA-256 hashed refresh tokens with reuse detection.
---

# ADR-0007: Server-Managed Sessions with Hashed Refresh Token Rotation

- **Status:** Accepted
- **Date:** 2026-11-17 (decision made earlier; documented on this date — exact original decision date not recorded)
- **Deciders:** Afzal (single maintainer; all decisions in v1 were made by the sole developer)
- **Related:** [Authentication & Sessions](../modules/auth.md), [Frontend Authentication & Token Flow](../api/authentication.md), [Secrets & Credential Hashing](../security/secrets-management.md)

## Context

An earlier iteration of Writespace stored refresh tokens as Redis keys matching `refresh_token:<userId>:*` (cleanup code for those legacy keys still exists in `AuthService.clearLegacyRefreshTokens` in `src/modules/auth/auth.service.ts`) and treated `HS256` access JWTs (`JWT_ACCESS_EXPIRE = 15m`) as self-contained proof of authentication.

That design had three gaps:

1. **Delayed revocation on security actions:** When a user revoked a session from their security settings (`DELETE /api/v1/sessions/:sessionId` or `POST /api/v1/sessions/revoke-others` in `src/modules/sessions/session.routes.ts`), changed or reset their password (`PUT /api/v1/users/me/password`, `POST /api/v1/auth/reset-password`), or had their account suspended (`DELETE /api/v1/users/:id`), any existing 15-minute access JWT remained usable until its `exp` timestamp passed.
2. **No refresh token theft detection:** If a refresh token was copied by an attacker, both the attacker and the legitimate user could refresh it repeatedly without the server detecting the compromise.
3. **Dual client types (`web` vs. `native`):** Browser clients need `HttpOnly` cookies protected against CSRF, whereas native mobile clients (`x-client-type: native`) store tokens in platform-secure storage and send them in the request body (`src/modules/auth/auth.controller.ts`).

## Options considered

| Option                                                                                                                                            | Summary                                                                                                                                                                                                                        | Why we accepted or rejected it                                                                                                                                                                                                                                           |
| :------------------------------------------------------------------------------------------------------------------------------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Stateless JWT access tokens + unrotated Redis refresh tokens**                                                                               | Verify only the JWT signature on API requests and check Redis only during `/auth/refresh-token`.                                                                                                                               | **Rejected.** Revoked sessions and suspended accounts stay active for up to 15 minutes (`JWT_ACCESS_EXPIRE`), and Redis keys give no relational audit trail (`security_events`) or token-reuse lineage.                                                                  |
| **B. Stateful `express-session` cookies for all requests**                                                                                        | Drop JWTs and use server-side session cookies for every endpoint.                                                                                                                                                              | **Rejected.** Native mobile clients (`x-client-type: native`) and Socket.IO handshakes (`socket.handshake.auth.token` in `src/modules/notification/realtime/notification-socket.server.ts`) work much cleaner with `Bearer` access tokens than with browser cookie jars. |
| **C. Session-bound `HS256` access JWTs (`{ id, role, sid }`) validated against `auth_sessions` + SHA-256 hashed `refresh_tokens` rotation chain** | Validate the JWT signature first, then check `auth_sessions` and `users.status` in PostgreSQL; store only SHA-256 hashes of 32-byte opaque refresh tokens with `parent_token_id` and `replaced_by_token_id` rotation pointers. | **Accepted.** Combines fast signature rejection of invalid tokens with immediate server-side session revocation and automatic compromise detection on refresh token reuse.                                                                                               |

## Decision

Every successful login (`password`, `google`, or `github`) or OTP verification creates a row in `auth_sessions` (`src/db/schema/auth-sessions.ts`) with an idle timeout (`SESSION_IDLE_TIMEOUT_SECONDS`, default 7 days / `604800s`) and an absolute timeout (`SESSION_ABSOLUTE_TIMEOUT_SECONDS`, default 30 days / `2592000s`), alongside an initial 32-byte random hex refresh token whose SHA-256 digest is stored in `refresh_tokens.token_hash` (`src/modules/sessions/session.service.ts`).

The short-lived `HS256` access JWT (`15m`) encodes `{ id: userId, role, sid: sessionId }` (`src/modules/auth/auth.service.ts`). On every authenticated HTTP request (`src/shared/middlewares/auth.middleware.ts`) and every Socket.IO connection handshake (`src/modules/notification/realtime/notification-socket.server.ts`), the server verifies the JWT signature and then calls `sessionService.isSessionValidForAccess(decoded.sid, decoded.id)`, which queries `auth_sessions` joined with `users` (`src/modules/sessions/session.repository.ts`) to confirm:

- `session.revokedAt` is `null`,
- both `idleExpiresAt` and `absoluteExpiresAt` are in the future, and
- `users.status` is neither `"suspended"` nor `"banned"`.

When `POST /api/v1/auth/refresh-token` is called, `RefreshTokenRepository.rotate` (`src/modules/sessions/refresh-token.repository.ts`) locks the `refresh_tokens` row `FOR UPDATE`. If `consumed_at` is null, it inserts a replacement token (`parent_token_id = record.tokenId`), marks the old token `consumed_at = now` and `replaced_by_token_id = successor.id`, and slides `auth_sessions.idle_expires_at` forward (capped at `absolute_expires_at`). If `consumed_at` is already non-null, it sets `reuse_detected_at = now`, revokes the parent `auth_sessions` row (`revoke_reason: "refresh_token_reuse"`), revokes all tokens in that session, and writes a `refresh_token.reuse_detected` row to `security_events` (which also enqueues a mandatory `auth.security_alert` outbox event).

## Consequences

### What this makes easy

Revoking a session (`DELETE /api/v1/sessions/:sessionId`), signing out other devices on a password change (`sessionService.revokeOtherUserSessionsInTransaction` in `src/modules/users/user.service.ts`), revoking all sessions on a password reset (`src/modules/auth/auth.service.ts`), or suspending a user (`UserService.deleteUser`) invalidates affected access tokens immediately on the next request. If an attacker steals a refresh token and either party uses the old token after rotation, the entire session is killed automatically and the user receives a high-priority security alert email and in-app notification. Furthermore, raw refresh tokens never exist in PostgreSQL; a database leak exposes only SHA-256 digests (`refresh_tokens.token_hash`).

### What this makes harder

Every authenticated HTTP request performs a primary-key/indexed lookup joining `auth_sessions` and `users` (`findForAccessValidation` in `src/modules/sessions/session.repository.ts`). On the client side, the frontend must serialize its `/api/v1/auth/refresh-token` calls so two browser tabs or concurrent `401` interceptors do not submit the same refresh token twice; otherwise, the second request will hit the `tokenConsumedAt` branch in `RefreshTokenRepository.rotate` and revoke the user's session as suspected token theft.

### What this forecloses

We cannot validate access tokens purely at a stateless edge worker or CDN without querying PostgreSQL (or introducing a short-TTL Redis session cache invalidated on revocation).

---

_Last verified against: v1.0.0 (12bc4d7, documentation branch, 2026-11-17)_
