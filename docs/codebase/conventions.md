---
description: Codebase layering rules, file naming patterns, service facade conventions, pure domain boundaries, and transaction propagation patterns in Writespace.
---

# Engineering Conventions

> **Purpose:** Document the architectural conventions, file naming patterns, and layering rules established in the Writespace codebase so new code stays consistent.
> **Audience:** Internal backend developers writing or reviewing code.
> **Prerequisites:** Read [Repository Structure](repository-structure.md) and [Module Ownership Map](module-map.md).

## Overview

Writespace is written in strict TypeScript (`"strict": true`, `"strictPropertyInitialization": false` in `tsconfig.json`) and linted with ESLint 9 (`eslint.config.mjs`). Across `src/modules/`, the codebase follows specific patterns for controller naming, facade composition, pure domain isolation, transaction passing, and cursor encoding.

## 1. File naming & controller export patterns

Most files follow `<domain>.<layer>.ts` in kebab-case (`auth.controller.ts`, `session.service.ts`, `reaction.repository.ts`, `create-post.dto.ts`). Be aware of three deliberate module-level patterns as they exist in the repository:

1. **Singular vs. plural controller filename (`interactions.controllers.ts`):** The interactions module exports a single `interactions.controllers.ts` file (plural) containing `InteractionsController` and `interactionsController` for all interaction sub-features (comment, follow, reaction, save, share), whereas `posts.controller.ts`, `articles.controller.ts`, `auth.controller.ts`, `user.controller.ts`, `session.controller.ts`, and `notification.controller.ts` use singular filenames.
2. **Static vs. instance controller methods:**
   - `UserController` (`src/modules/users/user.controller.ts`), `SessionController` (`src/modules/sessions/session.controller.ts`), `NotificationController` (`src/modules/notification/notification.controller.ts`), and `NotificationPreferenceController` (`src/modules/notification/notification-preference.controller.ts`) export classes with `public static async` handler methods.
   - `AuthController` (`src/modules/auth/auth.controller.ts`), `PostsController` (`src/modules/posts/posts.controller.ts`), `ArticlesController` (`src/modules/articles/articles.controller.ts`), and `InteractionsController` (`src/modules/interactions/interactions.controllers.ts`) export singleton controller instances (`authController`, `postsController`, `articlesController`, `interactionsController`).
3. **Path aliases vs. relative imports:** Cross-module and shared imports use the four `tsconfig.json` aliases (`@modules/*`, `@config/*`, `@shared/*`, `@db/*`), while intra-module imports (`./services/...`, `../domain/...`) use relative paths.

## 2. Facade + sub-services pattern (`posts`, `articles`, `interactions`)

In `src/modules/posts/` and `src/modules/articles/`, the top-level service file is the public facade consumed by the controller, while domain-specific logic lives in the `services/` subfolder and is composed by the facade:

| Module             | Top-Level Facade                                                           | Composed Sub-Services (`services/*`)                                                                                                                                                                                   | Additional Facade Responsibilities                                                                                                                                                                                                                                                                                                            |
| :----------------- | :------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`posts`**        | `src/modules/posts/posts.service.ts` (`postService`)                       | `postCommandService` (`post-command.service.ts`), `postQueryService` (`post-query.service.ts`), `postMediaService` (`post-media.service.ts`), `postPreviewService` (`post-preview.service.ts`)                         | `createPost` and `updatePost` call `postCommandService` and then hydrate the response via `postQueryService.getPost`. `likePost` and `sharePost` build canonical `/posts/:postId` share URLs and delegate to `interactionsService`. (Note: `PostsController.getPostPreview` calls `postPreviewService` directly.)                             |
| **`articles`**     | `src/modules/articles/articles.service.ts` (`articleService`)              | `articleCommandService` (`article-command.service.ts`), `articleQueryService` (`article-query.service.ts`), `articleMediaService` (`article-media.service.ts`), `articlePreviewService` (`article-preview.service.ts`) | `createArticle` and `updateArticle` call `articleCommandService` and hydrate via `articleQueryService.getArticleById`. `getPublicArticlePreview` delegates to `articlePreviewService`. `likeArticle` and `shareArticle` normalize 11 share platforms (`twitter` -> `x`), build `/articles/:slug` URLs, and delegate to `interactionsService`. |
| **`interactions`** | `src/modules/interactions/interactions.service.ts` (`interactionsService`) | `commentService` (`comment.service.ts`), `reactionService` (`reaction.service.ts`), `followService` (`follow.service.ts`), `saveService` (`save.service.ts`), `shareService` (`share.service.ts`)                      | Exposes both canonical `contentItemId` methods (`createContentItemComment`, `setContentItemReaction`, `saveContentItem`, `createContentItemShare`) and backward-compatible `postId` aliases (`createComment`, `setPostReaction`, `savePost`, `createShare`).                                                                                  |

## 3. Pure domain layer rule (`*/domain/`)

Files under `src/modules/posts/domain/`, `src/modules/articles/domain/`, and `src/modules/notification/domain/` hold pure domain logic and constants. **No database (`@db` or `drizzle-orm`), Redis, or Express imports are allowed in `*/domain/` files:**

- `src/modules/posts/domain/`:
  - `post-content.ts`: `countContentDocumentCharacters`, `extractContentText`, `collectMentionedUserIds`.
  - `post-lifecycle.ts`: `VALID_TRANSITIONS`, `canTransition`, `assertValidTransition`, `isPublicStatus`, `toPostStatus`.
  - `post-slug.ts` & `post.utils.ts`: Pure slug helpers (`generateBaseSlug`, `generateUniqueSlug`) and empty utility file.
- `src/modules/articles/domain/`:
  - `article-content.ts`: `extractArticleText`, `countArticleCharacters`, `countArticleWords`, `calculateArticleReadTime` (`WORDS_PER_MINUTE = 200`), `generateArticleExcerpt` (`DEFAULT_EXCERPT_LENGTH = 200`), `collectArticleMentionedUserIds`.
  - `article-lifecycle.ts`: `VALID_TRANSITIONS`, `canTransition`, `assertValidTransition`, `isPublicStatus`, `toArticleStatus`.
  - `article-slug.ts`: `generateArticleBaseSlug`, `generateArticleSlugCandidate`.
- `src/modules/notification/domain/`:
  - `event-name.ts` & `delivery-event-name.ts`: `DOMAIN_EVENT_NAMES`, `isDomainEventName`, `NOTIFICATION_DELIVERY_REQUESTED_EVENT`.
  - `notification-policy.registry.ts`: `NOTIFICATION_POLICY_VERSION` (`"notification-policy-v2"`), channel eligibility, and preference policies (`getNotificationPolicy`, `getInAppPreferencePolicies`).
  - `notification-grouping.policy.ts`: `POST_REACTION_GROUPING_WINDOW_MS` (`300000`), `GROUPED_NOTIFICATION_ACTOR_DISPLAY_LIMIT` (`3`), `createPostReactionGroupingKey`, `getPostReactionGroupingWindowStart`.

## 4. Transaction propagation pattern (`DatabaseTransaction`)

`src/db/index.ts` exports `DatabaseTransaction`, derived directly from `db.transaction`:

```typescript
export type DatabaseTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];
```

Repositories that participate in multi-step atomic operations (such as writing a domain change + updating a counter + recording an outbox event) follow one of two patterns:

- **Required** `transaction: DatabaseTransaction` **parameter:** Used by `FollowRepository.createFollow`, `SecurityEventRepository.create`, `EventPublisherService.recordInTransaction`, `ProcessedEventRepository.tryMarkProcessed`, `NotificationGroupRepository.addPostReactionToGroup`, and `NotificationRepository.create`. The caller service owns `await db.transaction(async (tx) => ...)` and passes `tx` into each repository call.

- **Optional** `transaction ?: DatabaseTransaction` **parameter (`withTransaction` helper):** Used by `ReactionRepository`, `CommentRepository.createComment`, `SaveRepository`, and `ShareRepository`. When `transaction` is supplied (e.g., when `env.OUTBOX_PROCESSING_ENABLED` is `true`), the repository executes on the caller's transaction; otherwise, it opens its own `db.transaction`.

## 5. Cursor pagination convention

Every cursor-paginated endpoint in Writespace (`posts`, `articles`, `comments`, `replies`, `saved-content`, `saved-posts`, `shares`, `notifications`) follows the same 4-part pattern:

1. **Microsecond timestamp formatting in SQL:** Select `to_char(<table>.<timestamp_col> AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` as an internal `cursorCreatedAt` or `cursorPublishDate` string so JavaScript `Date` millisecond truncation (3 decimal places) never loses PostgreSQL microsecond precision (6 decimal places).

2. **`limit + 1` lookahead fetch:** Query `.limit(limit + 1)` ordered by `DESC` on both the timestamp column and the tie-breaker ID column (`uuid` or `serial`).

3. **Slice and encode:** Set `hasMore = result.length > limit`, slice `result.slice(0, limit)`, strip the internal `cursor*` field from returned items, and encode the last returned item's `{ publishDate/createdAt, id }` as Base64URL JSON (`Buffer.from(JSON.stringify(cursor)).toString("base64url")`).

4. **Strict cursor validation on decode:** Validate incoming Base64URL cursors against `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/` and UUID/integer checks, throwing `400 Bad Request` (`AppError`) on malformed cursors.

## Key decisions & rationale

- **Why keep `strictPropertyInitialization: false` while `strict: true` is enabled in `tsconfig.json`?** This allows DTO and entity classes to declare properties without redundant definite-assignment assertions (`!`) while keeping `strictNullChecks`, `noImplicitAny`, and strict function types active across the codebase.

- **Why warn instead of error on `@typescript-eslint/no-unsafe-*` in `eslint.config.mjs`?** Express request/response generics and third-party middleware types (`passport`, `multer`) occasionally require boundary casts (`unknown` to typed DTOs), which are validated at runtime via Zod (`safeParse`).

## Gotchas & edge cases

- **Never use `Date.prototype.toISOString()` to build a database pagination cursor:** `toISOString()` truncates timestamps to milliseconds (`.123Z`), which fails `CURSOR_DATE_REGEX` (`/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/`) and can skip or duplicate rows sharing the same millisecond. Always use the SQL `to_char(..., 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` projection.

## Related

- [Repository Structure](./repository-structure.md)
- [Module Ownership Map](./module-map.md)
- [Pagination, Filtering & Sorting](../api/pagination-filtering-sorting.md)
- [Transactional Services & Locking](../backend/services.md)

_Last verified against: v1.0.0 (b97c4fa, documentation branch, 2026-11-17)_
