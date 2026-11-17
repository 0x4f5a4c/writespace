---
description: Deep-dive into the Users module, covering username availability, profile management, social links, account suspension, and dynamic Open Graph PNG generation.
---

# Users & Social Graph

> **Purpose:** Document the internal implementation of `src/modules/users/` and how it coordinates with `follows`, `sessions`, and Satori/Resvg Open Graph image generation.
> **Audience:** Internal backend developers working on user profiles, search, or account lifecycle.
> **Prerequisites:** Read [Domain Model & Entities](../concepts/domain-model.md) and [Authentication & Sessions](auth.md).

## Overview

The Users module (`src/modules/users/`) manages account profiles, public username availability checks during registration, case-insensitive user search, profile and banner image updates via Cloudinary, authenticated password changes, soft-delete account suspension, and dynamic 1200x630 PNG Open Graph card rendering. Directed user-to-user follow operations are shared with `FollowService` in `src/modules/interactions/services/follow.service.ts`.

## Module structure

| File                                            | Role                                                                                                                                                                                                                                                                    |
| :---------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/modules/users/user.routes.ts`              | Defines `/api/v1/users/*` routes and the pre-Multer ownership guard `authorizeProfileOwnerOrAdmin`.                                                                                                                                                                     |
| `src/modules/users/user.controller.ts`          | Static controller methods (`checkUsername`, `searchUsers`, `getMe`, `updatePassword`, `getProfile`, `updateProfile`, `deleteUser`, `toggleFollow`, `getProfileDynamicOgImage`).                                                                                         |
| `src/modules/users/user.service.ts`             | Business logic for availability suggestions, `ILIKE` search, profile projection, Cloudinary media path updates, transactional password change, and account suspension.                                                                                                  |
| `src/modules/users/interface/user.interface.ts` | Defines `PublicUser` (returned to `/me` and profile updates) and `PublicProfile` (returned when viewing another user's profile at `/profile/:username`).                                                                                                                |
| `src/modules/users/dtos/update-profile.dto.ts`  | Zod schema validating `personal_info` (`fullname` min 3, `headline` max 200, `location` max 100, `bio` max 500) and 10 `social_links` URLs (`twitter`, `github`, `website`, `linkedin`, `instagram`, `youtube`, `facebook`, `leetcode`, `geeksforgeeks`, `codeforces`). |
| `src/modules/users/dtos/update-password.dto.ts` | Zod schema validating `currentPassword` and `newPassword` (min 8 chars, uppercase, lowercase, number).                                                                                                                                                                  |

## Core workflows & projections

### 1. `PublicUser` vs. `PublicProfile` projections (`user.interface.ts`)

The Users module distinguishes between a user reading their own account record (`GET /api/v1/users/me`, `PUT /api/v1/users/:id`) and an authenticated user viewing someone else's profile (`GET /api/v1/users/profile/:username`):

| Projection Type                                    | Used By                                                                                              | Included / Excluded Fields                                                                                                                                                                                                                                                                                                                                                                             |
| :------------------------------------------------- | :--------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`PublicUser`**                                   | `UserService.getMe`, `UserService.updateUser`, `AuthService.login`, `AuthService.verifyRegistration` | Returns all `users` columns **except** `passwordHash`, `loginAttempts`, `lockUntil`, `googleAuth`, and `githubAuth`. Includes the user's `email`, `role`, `status`, `profileImagePublicId`, `bannerImagePublicId`, and `updatedAt`.                                                                                                                                                                    |
| **`PublicProfile & { isFollowingByMe: boolean }`** | `UserService.getUserProfile` (`GET /api/v1/users/profile/:username`)                                 | Explicitly selects **only** public columns (`id`, `fullname`, `username`, `bio`, `headline`, `location`, `profileImageUrl`, `bannerImageUrl`, the 10 social links, `totalPosts`, `totalReads`, `totalFollowers`, `totalFollowing`, `createdAt`) where `status = 'active'`, plus a boolean `isFollowingByMe` lookup from `follows`. Omits `email`, `role`, `status`, and Cloudinary `publicId` columns. |

### 2. Username availability & candidate generation (`checkUsernameAvailability`)

`GET /api/v1/users/check-username?username=<str>` is the only unauthenticated endpoint in `user.routes.ts`. `UserService.checkUsernameAvailability` normalizes the query (`trim().toLowerCase()`) and checks `users.username`. If the username is taken, it runs up to 15 iterations generating `<normalizedUsername><random 3-digit number 100..999>` and querying `users` until it collects up to 3 available username suggestions (`{ available: false, suggestions }`).

### 3. User search (`searchUsers`)

`GET /api/v1/users/search?q=<query>` requires authentication and calls `UserService.searchUsers(query, 5)`. Empty or whitespace-only queries return `[]` without hitting PostgreSQL. Non-empty queries run a case-insensitive `ILIKE` match (`%${query}%`) against `users.username` and `users.fullname` restricted to `status = "active"`, returning at most 5 rows with `{ id, username, fullname, profileImageUrl, headline }`.

### 4. Profile & image updates (`updateUser`)

`PUT /api/v1/users/:id` executes middlewares in this order (`src/modules/users/user.routes.ts`):

1. `authenticate`: Verifies the caller's JWT and active session.
2. `authorizeProfileOwnerOrAdmin`: Rejects the request with `403 Forbidden` if `req.params.id !== req.user.id && req.user.role !== "admin"` **before** Multer streams any files to Cloudinary.
3. `upload.fields([{ name: "profileImage", maxCount: 1 }, { name: "bannerImage", maxCount: 1 }])`: Streams uploaded avatar/banner files to `uploads/users/<userId>/` in Cloudinary.
4. `parseFormDataJson` + `validate(UpdateProfileSchema)`: Validates `personal_info` and `social_links`.
5. `UserService.updateUser`: Updates only supplied fields. If `personal_info.fullname` is modified (`isCriticalUpdate = true`), it enqueues a confirmation email via `notificationService.sendProfileUpdateEmail(updated.email, updated.username)`.

### 5. Account suspension (`deleteUser`)

`DELETE /api/v1/users/:id` does **not** delete the row from `users`. Instead, `UserService.deleteUser(id)`:

- Locks the `users` row with `FOR UPDATE`.
- Sets `users.status = "suspended"`.
- Revokes all active sessions and refresh tokens in the same transaction (`sessionService.revokeAllUserSessionsInTransaction(tx, userId, now, "account_suspended")`).
- If the account was not already `"suspended"`, creates an `account.suspended` row in `security_events` (which also records an `auth.security_alert` outbox event so the user receives a mandatory suspension email even though their status is now `"suspended"`).
- Cleans up any legacy Redis refresh tokens (`authService.revokeAllRefreshTokens(userId)`).

## Key decisions & rationale

- **Why require authentication on `GET /api/v1/users/profile/:username` and `GET /api/v1/users/og/:username`?** As noted in `src/modules/users/user.routes.ts`, all `/api/v1/users/*` routes except `/check-username` require `authenticate`. Social media crawlers fetching public profile previews hit `GET /profile/:username` at the root app level, which is intercepted by `botInterceptor` (`src/shared/middlewares/bot-interceptor.middleware.ts`) before `/api/v1` authentication runs.

## Gotchas & edge cases

- **Multipart `personal_info` and `social_links` in `PUT /api/v1/users/:id`:** `parseFormDataJson` (`src/shared/middlewares/parse-form-data.middleware.ts`) only auto-parses JSON strings for field names in `["tags", "codeSnippets", "existingMedia", "existingMediaPublicIds"]`. It does **not** parse `personal_info` or `social_links` when sent as JSON strings in a `multipart/form-data` request. Clients updating text fields via `application/json` work normally, while multipart requests uploading `profileImage`/`bannerImage` must either omit `personal_info`/`social_links` or send bracketed form fields if supported by the body parser.
- **Replaced profile and banner images are not enqueued to `media-cleanup`:** Unlike `PostCommandService` and `ArticleCommandService`, `UserService.updateUser` overwrites `profileImagePublicId` and `bannerImagePublicId` on the `users` row without enqueueing the previous Cloudinary `publicId` to `addMediaCleanupJob`.
- **Username case sensitivity during registration vs. availability check:** `UserService.checkUsernameAvailability` and `UserService.getUserProfile` normalize `username.trim().toLowerCase()`, whereas `AuthService.initiateRegistration` (`src/modules/auth/auth.service.ts`) inserts `data.username` directly as validated by `registerSchema`. Frontend registration forms should lowercase usernames before submission.

## Related

- [Authentication & Sessions](auth.md)
- [Comments, Reactions, Saves & Shares](interactions.md)
- [Media & OG Image Handling](media.md)
- [User & Follow Endpoints](../api/endpoints/users.md)

---

_Last verified against: v1.0.0 (b97c4fa, documentation branch, 2026-11-17)_
