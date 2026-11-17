---
description: Why Posts and Articles share a 1:1 UUID primary key with the parent content_items table instead of using polymorphic or dual foreign keys.
---

# ADR-0001: Shared Content Identity (`content_items`)

- **Status:** Accepted
- **Date:** 2026-11-17 (decision made earlier; documented on this date — exact original decision date not recorded)
- **Deciders:** Afzal (single maintainer; all decisions in v1 were made by the sole developer)
- **Related:** [ADR-0002](ADR-0002-structured-content-document.md), [ADR-0008](ADR-0008-transactional-denormalized-counters.md), [Domain Model & Entities](../concepts/domain-model.md), [Posts & Articles (Shared Content)](../modules/content.md)

## Context

Writespace started with short-form Posts as its only content type. You can still see remnants of that first iteration in `src/modules/interactions/interactions.routes.ts`, where legacy routes like `POST /interactions/comments/:postId` and `POST /interactions/posts/:postId/save` exist alongside the newer `/interactions/content/:contentItemId/*` routes.

When we added long-form Articles (`src/modules/articles/`), both content types needed the exact same publishing lifecycle (`draft`, `scheduled`, `published`), the same engagement counters (`view_count`, `reaction_count`, `comment_count`, `share_count`), and the same five social tables: `comments`, `content_reactions`, `content_saves`, `content_shares`, and `content_mentions`. At the same time, Posts and Articles have different shapes. Articles have a required `title` (5 to 200 characters), a unique URL `slug`, an optional `subtitle`, an `excerpt`, `read_time`, and a single cover image (`src/db/schema/articles.ts`). Short Posts have none of those columns (`src/db/schema/posts.ts`), cap visible text at 6,000 characters (`src/modules/posts/dtos/create-post.dto.ts`), and attach up to five ordered images in `post_media`.

We needed a relational layout that let every interaction table point to either a Post or an Article with real PostgreSQL foreign keys and cascading deletes, without forcing Posts and Articles into a single wide table full of nullable columns.

## Options considered

| Option                                                          | Summary                                                                                                                                                                                                       | Why we accepted or rejected it                                                                                                                                                                                                                                                                                                                                                                                                    |
| :-------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Single Table Inheritance (`contents`)**                    | Put Posts and Articles into one table with a `content_type` enum and nullable Article columns (`title`, `slug`, `read_time`, `cover_image_*`).                                                                | **Rejected.** In our seed dataset (`src/scripts/seed/seed-data.ts`), 60% of content items are Posts. Every Post row would carry eight permanently null Article columns, and PostgreSQL could not enforce `NOT NULL` on `articles.title` or `articles.slug` without brittle multi-column `CHECK` constraints.                                                                                                                      |
| **B. Separate tables with dual FKs or polymorphic `target_id`** | Keep `posts` and `articles` completely independent. Either put nullable `post_id` and `article_id` columns on all five interaction tables, or store an unindexed polymorphic `(target_type, target_id)` pair. | **Rejected.** Polymorphic `target_id` columns cannot use PostgreSQL foreign keys or `ON DELETE CASCADE` (we only tolerate polymorphic targets in `interaction_events` where rows are historical logs). Dual nullable FKs would have required `CHECK ((post_id IS NOT NULL) <> (article_id IS NOT NULL))` and duplicate indexes across `comments`, `content_reactions`, `content_saves`, `content_shares`, and `content_mentions`. |
| **C. Class Table Inheritance via `content_items`**              | Create a parent `content_items` table owning the UUID, author, lifecycle, counters, and `version`. Make `posts.id` and `articles.id` 1:1 primary-key/foreign-key references to `content_items.id`.            | **Accepted.** Gives every interaction table a single `content_item_id` foreign key with `ON DELETE CASCADE` while keeping Post-only and Article-only columns strictly typed in their own subtype tables.                                                                                                                                                                                                                          |

## Decision

We split publishable content into a parent `content_items` table (`src/db/schema/content-items.ts`) and two 1:1 subtype tables: `posts` (`src/db/schema/posts.ts`) and `articles` (`src/db/schema/articles.ts`). Both subtype tables declare their primary key as a foreign key to `content_items.id` without `defaultRandom()`:

```typescript
export const posts = pgTable("posts", {
  id: uuid("id")
    .primaryKey()
    .references(() => contentItems.id, { onDelete: "cascade" }),
  contentDocument: jsonb("content_document").$type<ContentDocument>().notNull(),
  tags: text("tags").array().notNull().default([]),
});
```

All five social tables (`comments`, `content_reactions`, `content_saves`, `content_shares`, and `content_mentions`) reference `content_items.id` via `content_item_id` (`ON DELETE CASCADE`).

## Consequences

### What this makes easy

The interaction module (`src/modules/interactions/`) does not care whether a user is commenting on, reacting to, or bookmarking a Post or an Article. A single `DELETE FROM content_items WHERE id = :id` in `PostCommandService.deletePost` (`src/modules/posts/services/post-command.service.ts`) or `ArticleCommandService.deleteArticle` (`src/modules/articles/services/article-command.service.ts`) cascades through the subtype row, `post_media`, `content_mentions`, `content_reactions`, `content_saves`, `content_shares`, `comments`, and `comment_reactions` in one database operation. We also kept backward compatibility with older Post-oriented API routes by aliasing `:postId` route parameters directly to `contentItemId` in `src/modules/interactions/interactions.service.ts`.

### What this makes harder

Every content creation flow must open a transaction, insert into `content_items` first, read back the generated `id`, and then insert into `posts` or `articles` using that exact UUID (`src/modules/posts/services/post-command.service.ts`, `src/modules/articles/services/article-command.service.ts`). Every feed and detail query (`src/modules/posts/services/post-query.service.ts`, `src/modules/articles/services/article-query.service.ts`) requires an `INNER JOIN` between `content_items` and `posts` or `articles`.

More subtly, a single-column foreign key in PostgreSQL cannot enforce that a row in `posts` points to a `content_items` row where `content_type = 'post'`. Nothing at the constraint level stops a buggy service from attaching a `posts` row to an `'article'` parent or creating a `content_items` row with no child subtype row at all. Because of that, repositories in `src/modules/interactions/repositories/reaction.repository.ts`, `comment.repository.ts`, and `save.repository.ts` explicitly check `content_items.content_type` and verify that the matching `posts` or `articles` row exists before writing interactions.

### What this forecloses

We cannot move `posts` and `articles` into separate database instances without either duplicating `content_items` or giving up foreign key enforcement on interactions. If we ever add a third content type (such as polls or Til snippets), it must follow the same two-step insert pattern into `content_items` and its subtype table.

---

_Last verified against: v1.0.0 (12bc4d7, documentation branch, 2026-11-17)_
