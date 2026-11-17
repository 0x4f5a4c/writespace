---
description: Why Writespace stores denormalized integer counters on users, content_items, and comments and updates them inside FOR UPDATE transactions.
---

# ADR-0008: Denormalized Counters Maintained Transactionally

- **Status:** Accepted
- **Date:** 2026-11-17 (decision made earlier; documented on this date — exact original decision date not recorded)
- **Deciders:** Afzal (single maintainer; all decisions in v1 were made by the sole developer)
- **Related:** [ADR-0001](ADR-0001-shared-content-identity.md), [Cross-Cutting Concerns](../architecture/cross-cutting.md), [Transactional Services & Locking](../backend/services.md)

## Context

Almost every read response in Writespace displays engagement or profile totals:

- Post and Article feeds (`src/modules/posts/services/post-query.service.ts`, `src/modules/articles/services/article-query.service.ts`) return `viewCount`, `reactionCount`, `commentCount`, and `shareCount` for up to 50 items per page.
- Comment threads (`src/modules/interactions/repositories/comment.repository.ts`) return `likeCount` (mapped from `comments.reaction_count`) and `replyCount` for every comment.
- User profiles (`src/modules/users/user.service.ts`) return `totalPosts`, `totalReads`, `totalFollowers`, and `totalFollowing`.

Calculating those counts on the fly with `COUNT(*)` subqueries or `GROUP BY` joins across `content_reactions`, `comments`, `content_shares`, and `follows` on every feed page load would do repeated aggregate scans on our most frequent read queries. However, storing denormalized counters on the parent rows only works if concurrent writes cannot drift the counters out of sync or drive them below zero.

## Options considered

| Option                                                                                                                | Summary                                                                                                                                                                                                               | Why we accepted or rejected it                                                                                                                                              |
| :-------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Live `COUNT(*)` subqueries on read**                                                                             | Omit counter columns and compute counts in `SELECT` queries.                                                                                                                                                          | **Rejected.** Adds multiple correlated subqueries or aggregate joins to every 20-to-50 item feed page and profile lookup.                                                   |
| **B. PostgreSQL triggers on child tables**                                                                            | Create `AFTER INSERT OR DELETE` triggers on `content_reactions`, `comments`, `content_shares`, and `follows` to update parent counters.                                                                               | **Rejected.** Hides write locks and counter logic inside SQL migration files rather than keeping them visible alongside outbox event publishing in TypeScript repositories. |
| **C. Denormalized columns updated in application transactions under `FOR UPDATE` locks + `CHECK (>= 0)` constraints** | Store integer counters on `users`, `content_items`, and `comments`, guard them with SQL `CHECK` constraints, and update them in the same Drizzle transaction as the child insert/delete after locking the parent row. | **Accepted.** Keeps feed and profile reads to a single row lookup while keeping lock ordering and counter updates explicit in repository code.                              |

## Decision

We stored denormalized integer counters directly on three parent tables:

- `users` (`src/db/schema/users.ts`): `total_posts`, `total_reads`, `total_followers`, `total_following`.
- `content_items` (`src/db/schema/content-items.ts`): `view_count`, `reaction_count`, `comment_count`, `share_count` (guarded by `content_items_nonnegative_counters_check`).
- `comments` (`src/db/schema/comments.ts`): `reaction_count`, `reply_count` (guarded by `comments_nonnegative_counters_check`).

Whenever an interaction repository mutates a child table (`src/modules/interactions/repositories/reaction.repository.ts`, `comment.repository.ts`, `follow.repository.ts`, `share.repository.ts`), it first locks the parent row(s) with `.for("update")` in a deterministic order (for example, `content_items` before `comments` or `content_reactions`, and `users` ordered by `asc(users.id)` in `FollowRepository`), verifies whether the child insert or delete actually changed state (`onConflictDoNothing().returning()`), and updates the counter in the same transaction. Decrements use `GREATEST(column - 1, 0)` (or an exact `SELECT COUNT(*)::int` subquery when deleting a comment in `CommentRepository.deleteComment` because `ON DELETE CASCADE` removes an arbitrary number of nested replies at once).

## Consequences

### What this makes easy

Feed queries in `PostQueryService.getPosts` and `ArticleQueryService.getArticles` read `viewCount`, `reactionCount`, `commentCount`, and `shareCount` straight off the `content_items` table with zero aggregate subqueries. If counters ever need to be rebuilt after a manual data import or fixture load, `seedCounters` in `src/scripts/seed/counters.seed.ts` recomputes all ten counters from the child tables in a single transaction.

### What this makes harder

Every reaction, comment, share, and follow serializes on the parent row's `FOR UPDATE` lock for the duration of the transaction. We also have to maintain strict lock ordering across modules: for instance, `NotificationRepository.hasFollowRelationship` (`src/modules/notification/repositories/notification.repository.ts`) must lock `users` in the exact same `ORDER BY users.id ASC FOR UPDATE` order as `FollowRepository.createFollow` (`src/modules/interactions/repositories/follow.repository.ts`) so a background worker checking a follow does not deadlock with a user unfollowing at the same instant.

Two quirks in the current codebase are also worth noting:

1. `users.total_posts` is incremented by both `PostCommandService.createPost` (`src/modules/posts/services/post-command.service.ts`) and `ArticleCommandService.createArticle` (`src/modules/articles/services/article-command.service.ts`) on creation—even for drafts—so `totalPosts` represents total authored content items (`posts` + `articles`), matching `seedCounters` in `src/scripts/seed/counters.seed.ts`.
2. `content_items.view_count` and `users.total_reads` are populated by the seed script (`src/scripts/seed/seed-data.ts`, `counters.seed.ts`), but no HTTP endpoint in `src/modules/posts/` or `src/modules/articles/` currently increments `view_count` or `total_reads` on `GET` requests (`> TODO(owner): verify whether view/read tracking is deferred to the traffic analytics item on the v2 roadmap`).

### What this forecloses

Under this design, thousands of users reacting to the same viral post at the exact same second will queue on the row lock for that single `content_items` row. Revisit by buffering high-frequency counter increments in Redis or a partitioned counter-deltas table if single-item write lock wait times become measurable.

---

_Last verified against: v1.0.0 (12bc4d7, documentation branch, 2026-11-17)_
