---
description: Deep-dive into the Interactions module, covering threaded comments, 7-type reactions, user follows, saved content bookmarks, platform shares, and dual event recording.
---

# Comments, Reactions, Saves & Shares

> **Purpose:** Document the internal implementation of `src/modules/interactions/`, including row locking, denormalized counter maintenance, idempotency rules, and dual event publishing (`outbox_events` vs. `interaction_events`).
> **Audience:** Internal backend developers maintaining social interactions.
> **Prerequisites:** Read [ADR-0001: Shared Content Identity (`content_items`)](../decisions/ADR-0001-shared-content-identity.md) and [ADR-0008: Denormalized Counters Maintained Transactionally](../decisions/ADR-0008-transactional-denormalized-counters.md).

## Overview

The Interactions module (`src/modules/interactions/`) owns all social engagement across Posts, Articles, comments, and users:

1. **Comments & Threaded Replies** (`services/comment.service.ts`, `repositories/comment.repository.ts`)
2. **Content & Comment Reactions** (`services/reaction.service.ts`, `repositories/reaction.repository.ts`)
3. **Directed User Follows** (`services/follow.service.ts`, `repositories/follow.repository.ts`)
4. **Saved Content Bookmarks** (`services/save.service.ts`, `repositories/save.repository.ts`)
5. **Platform Shares** (`services/share.service.ts`, `repositories/share.repository.ts`)
6. **Historical Activity Log** (`events/interaction-event.mapper.ts`, `events/interaction-event.publisher.ts`, `repositories/interaction-event.repository.ts`)

## Interaction sub-modules & invariants

### 1. Comments & threaded replies (`comment.service.ts` & `comment.repository.ts`)

- **Published-content guard:** Creating a comment (`createComment`) locks the target `content_items` row `FOR UPDATE`, verifies `status === "published"` and that the subtype row in `posts` or `articles` exists, and returns `404 Not Found` (`"Content not found"`) if missing or unpublished.
- **Same-content-item parent verification:** When `parentCommentId` is supplied, `CommentService.createComment` checks that the parent comment exists and belongs to the same `contentItemId` (`400 Bad Request`: `"Parent comment does not belong to this content item"`), and `CommentRepository.createComment` re-verifies and locks the parent comment row with `FOR UPDATE` inside the transaction.
- **Counter updates on create vs. delete:**
  - On **create**, `content_items.comment_count` increments by `1`, and if `parentCommentId` is set, the parent comment's `reply_count` increments by `1`.
  - On **delete** (`deleteComment`), `comments.parent_comment_id` has `ON DELETE CASCADE`, so deleting a comment automatically deletes all of its nested replies at the database level. Because more than one row may have been removed by the cascade, `CommentRepository.deleteComment` locks `content_items` `FOR UPDATE`, deletes the target comment, and recalculates `content_items.comment_count` (and the parent comment's `reply_count`, if applicable) using an exact `SELECT COUNT(*)::int FROM comments WHERE ...` subquery inside the same transaction.
- **Authorization on edit vs. delete:** Only the comment author (`comment.authorId === userId`) can edit a comment (`updateComment`, which sets `isEdited: true`). Both the comment author **and** an admin (`req.user?.role === "admin"`) can delete a comment (`deleteComment`). Note that `getCommentByIdForManagement` omits the `content_items.status = 'published'` filter so authors/admins can still edit or delete comments on content that was subsequently unpublished.

### 2. Seven-type reactions (`reaction.service.ts` & `reaction.repository.ts`)

Both `content_reactions` (`(content_item_id, user_id)`) and `comment_reactions` (`(comment_id, user_id)`) share the 7-value PostgreSQL enum `reaction_type`: `"like"`, `"love"`, `"laugh"`, `"celebrate"`, `"support"`, `"sad"`, and `"angry"`.

| Operation                                                                 | Repository Behavior & Lock Order                                                                                                                                                                                                                                                                              | Counter Effect                                                         | Outbox & History Event Emitted                              |
| :------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :--------------------------------------------------------------------- | :---------------------------------------------------------- |
| **New reaction** (`previousReactionType === null`)                        | Locks `content_items` `FOR UPDATE` (requires `status === "published"`), then locks `comments` `FOR UPDATE` (if comment reaction), then inserts reaction row.                                                                                                                                                  | Increments `reaction_count + 1`                                        | `reaction.added`                                            |
| **Changed reaction** (`previousReactionType !== reactionType`)            | Updates `reaction_type` and `updated_at` on the locked reaction row.                                                                                                                                                                                                                                          | **No change** (`+0`)                                                   | `reaction.changed`                                          |
| **Repeated identical reaction** (`previousReactionType === reactionType`) | No-op (idempotent).                                                                                                                                                                                                                                                                                           | **No change** (`+0`)                                                   | **None** (`mutation: null`)                                 |
| **Remove reaction** (`removeReaction`)                                    | Locks parent row (`content_items` for content reactions), deletes reaction row. Allowed even if content was unpublished after the reaction was created.                                                                                                                                                       | Decrements `GREATEST(reaction_count - 1, 0)` only if a row was deleted | `reaction.removed` (carries the deleted `reactionType`)     |
| **Toggle Like** (`toggleContentItemLike`)                                 | Used by `POST /api/v1/posts/:id/like` and `POST /api/v1/articles/:id/like`. If no reaction exists: inserts `'like'` (`+1`, `reaction.added`). If `'like'` exists: deletes it (`-1`, `reaction.removed`). If a _different_ reaction (e.g. `'love'`) exists: changes it to `'like'` (`+0`, `reaction.changed`). | `+1`, `-1`, or `+0`                                                    | `reaction.added`, `reaction.removed`, or `reaction.changed` |

### 3. Directed user follows (`follow.service.ts` & `follow.repository.ts`)

- **Self-follow guard:** `followUser`, `unfollowUser`, and `toggleFollow` reject `actorId === targetUserId` with `400 Bad Request` (`"You cannot follow/unfollow yourself"`).
- **Deadlock-free lock order:** `FollowRepository.createFollow`, `deleteFollow`, and `toggleFollow` always lock both user rows in ascending UUID order (`WHERE id IN (followerId, followingId) ORDER BY id ASC FOR UPDATE`) before inserting or deleting in `follows` and updating `users.total_following` and `users.total_followers` with a single `CASE WHEN` `UPDATE` statement.
- **Idempotency:** Calling `followUser` when already following (or `unfollowUser` when not following) returns `isFollowing: true` / `false` without modifying counters or emitting duplicate `follow.created` / `follow.removed` events.

### 4. Saved content bookmarks (`save.service.ts` & `save.repository.ts`)

- **Shared vs. legacy Post endpoints:**
  - `POST / DELETE /api/v1/interactions/content/:contentItemId/save` and `GET /api/v1/interactions/saved-content` operate on both Posts and Articles (`saveContentItem`, `unsaveContentItem`, `getSavedContent`), returning `{ contentItemId, contentType, userId, createdAt }`.
  - `POST / DELETE /api/v1/interactions/posts/:postId/save` and `GET /api/v1/interactions/saved-posts` verify that the target is specifically a `"post"` (`ensurePostExists`) and use `{ createdAt, postId }` cursors for backward compatibility.
- **No public counter:** Unlike reactions, comments, and shares, saves are private bookmarks (`content_saves`) and do **not** maintain a `save_count` column on `content_items` or generate author notifications (`NotificationProcessorService` marks `save.created` and `save.removed` as `no_delivery_required`).

### 5. Append-only platform shares (`share.service.ts` & `share.repository.ts`)

- **Multiple shares per user allowed:** Unlike `content_reactions` and `content_saves`, `content_shares` uses a `serial` primary key (`id`). Every share action inserts a new row and increments `content_items.share_count + 1` inside a transaction that locks `content_items` `FOR UPDATE` and verifies `status === "published"`.
- **Pagination tie-breaker:** Because `content_shares.id` is a `serial` integer, `ShareCursor` uses `{ createdAt: string, id: number }` rather than a UUID tie-breaker.

## Dual event recording (`outbox_events` vs. `interaction_events`)

Every mutating interaction service (`ReactionService`, `FollowService`, `SaveService`, `ShareService`) writes to two different event tables at different points in the lifecycle:

| Aspect             | `outbox_events` (`eventPublisherService.recordInTransaction`)                     | `interaction_events` (`interactionEventPublisher.publish`)                                                                                                        |
| :----------------- | :-------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **When Written**   | **Inside** `db.transaction` before commit (when `OUTBOX_PROCESSING_ENABLED=true`) | **After** `db.transaction` commits (synchronous `INSERT` in `try / catch`)                                                                                        |
| **Failure Impact** | Rolls back the entire business mutation                                           | Logged via `logger.error`; user request still returns `200`/`201`                                                                                                 |
| **Events Covered** | All 8 interaction events **plus** `comment.created` and `comment.replied`         | `reaction.added`, `reaction.changed`, `reaction.removed`, `follow.created`, `follow.removed`, `save.created`, `save.removed`, `share.created` (excludes comments) |
| **Consumer**       | `outboxDispatcherWorker` → `notificationProcessorService`                         | Stored for historical activity queries (`InteractionEventRepository`)                                                                                             |

## Key decisions & rationale

- **Why keep both generic `/content/:contentItemId/*` and legacy `/posts/:postId/*` routes in `interactions.routes.ts`?** When Writespace expanded from Posts-only to the shared `content_items` architecture (`ADR-0001`), keeping the legacy route paths and `postId` response aliases allowed existing frontend views to continue working while new Article and unified views use `/content/:contentItemId/*`.

## Gotchas & edge cases

- **No generic `/interactions/content/:contentItemId/reaction` route yet:** Although `ReactionService` (`src/modules/interactions/services/reaction.service.ts`) implements `setContentItemReaction` and `removeContentItemReaction`, `src/modules/interactions/interactions.routes.ts` currently mounts `POST / DELETE /api/v1/interactions/posts/:postId/reaction`. Because `setPostReaction` delegates directly to `setContentItemReaction(actorId, postId, reactionType)` without filtering `contentType === 'post'`, passing an Article UUID as `:postId` on `/api/v1/interactions/posts/:postId/reaction` works for both Posts and Articles!
- **Comment responses return `likeCount` as an alias for `comments.reaction_count`:** In `CommentRepository.getTopLevelComments`, `getCommentReplies`, and `getCommentById` (`src/modules/interactions/repositories/comment.repository.ts`), the total count of all 7 reaction types on a comment is returned under the property name `likeCount: comments.reactionCount`, alongside the caller's specific `reactionType` and `isReacted` boolean.

## Related

- [Posts & Articles (Shared Content)](content.md)
- [Notifications, Outbox & Realtime](notifications.md)
- [Interaction & Comment Endpoints](../api/endpoints/interactions.md)
- [ADR-0008: Denormalized Counters Maintained Transactionally](../decisions/ADR-0008-transactional-denormalized-counters.md)

---

_Last verified against: v1.0.0 (b97c4fa, documentation branch, 2026-11-17)_
