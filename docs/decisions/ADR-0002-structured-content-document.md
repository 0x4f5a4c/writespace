---
description: Why Writespace stores Post and Article bodies as versioned ContentDocument JSONB blocks while keeping Post images in post_media.
---

# ADR-0002: Structured JSONB `ContentDocument` & Externalized `post_media`

- **Status:** Accepted
- **Date:** 2026-11-17 (decision made earlier; documented on this date — exact original decision date not recorded)
- **Deciders:** Afzal (single maintainer; all decisions in v1 were made by the sole developer)
- **Related:** [ADR-0001](ADR-0001-shared-content-identity.md), [Posts & Articles (Shared Content)](../modules/content.md), [Media & OG Image Handling](../modules/media.md)

## Context

Developers writing on Writespace mix prose paragraphs, external hyperlinks, `@user` mentions, and code snippets. We needed a storage format for `posts` and `articles` that satisfied four concrete backend requirements:

1. Posts have a hard 6,000-character limit (`MAX_POST_CHARACTERS = 6000` in `src/modules/posts/services/post-command.service.ts`), where visible paragraph text, visible link labels, and code blocks count toward the limit, but link destination URLs and `@mention` UUIDs do not (`src/modules/posts/domain/post-content.ts`).
2. Every `@mention` in a published Post or Article must point to a real row in `users`, populate the `content_mentions` lookup table (`src/db/schema/content-mentions.ts`), and emit a `mention.created` outbox event only for newly added mentions when an already-published item is edited (`src/modules/articles/services/article-command.service.ts`).
3. Social preview generators (`src/shared/middlewares/bot-interceptor.middleware.ts`, `src/modules/posts/services/post-preview.service.ts`, `src/modules/articles/services/article-preview.service.ts`) need to extract clean plain text without leaking raw user UUIDs from mention nodes.
4. Posts allow up to 5 ordered image attachments (`MAX_POST_MEDIA = 5` in `src/modules/posts/services/post-media.service.ts`). When a user edits a Post to remove two images and upload one new image, the backend must verify that new uploads belong to `uploads/users/<userId>/`, preserve the database IDs of retained images, compact their `0..N-1` positions, and enqueue the removed Cloudinary `public_id` strings to `media-cleanup` (`src/shared/queues/media.queue.ts`) after the transaction commits.

## Options considered

| Option                                                                                          | Summary                                                                                                                                                                      | Why we accepted or rejected it                                                                                                                                                                                                                                                                                                             |
| :---------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Raw Markdown or HTML string**                                                              | Store a `text` column containing Markdown or HTML and sanitize it with `sanitize-html`.                                                                                      | **Rejected.** Extracting `@mention` UUIDs from Markdown or HTML via regexes is fragile, and computing the 6,000-character Post limit while excluding link URLs and mention UUIDs requires parsing the string into an AST on every write anyway.                                                                                            |
| **B. JSONB `ContentDocument` with inline image blocks**                                         | Store a block array in JSONB that includes `{ type: "image", url, publicId }` blocks alongside paragraphs and code blocks.                                                   | **Rejected.** Diffing old vs. new Cloudinary `public_id` references across arbitrary JSONB edits to prevent orphaned Cloudinary files is error-prone. A client could also tamper with an existing image block's `publicId` or `url` in the JSON payload unless the server deep-compared every image block against previous database state. |
| **C. Versioned JSONB `ContentDocument` for text/code/mentions + relational `post_media` table** | Store `paragraph` and `code` blocks in `content_document` (`jsonb`), store Post images as ordered rows in `post_media`, and sync unique mention UUIDs to `content_mentions`. | **Accepted.** Separates text AST rules from Cloudinary asset lifecycle management.                                                                                                                                                                                                                                                         |

## Decision

We defined a shared `ContentDocument` contract in `src/db/schema/content-document.ts` stored in `posts.content_document` and `articles.content_document`:

```typescript
export interface ContentDocument {
  version: 1;
  blocks: Array<ContentParagraphBlock | ContentCodeBlock>;
}
```

Paragraph blocks contain an array of discriminated inline nodes (`text`, `link`, or `mention` carrying `{ userId: string }`). Code blocks carry `{ language: string, code: string }`. Images are excluded from `ContentDocument`. Instead, Post images are stored in `post_media` (`src/db/schema/post-media.ts`) with a unique `(post_id, position)` index, and Article cover images are stored in four dedicated columns on `articles` (`cover_image_url`, `cover_image_public_id`, `cover_image_alt_text`, `cover_image_credit` in `src/db/schema/articles.ts`).

## Consequences

### What this makes easy

Domain functions in `src/modules/posts/domain/post-content.ts` and `src/modules/articles/domain/article-content.ts` (`countContentDocumentCharacters`, `extractContentText`, `collectMentionedUserIds`, `calculateArticleReadTime`) are pure, synchronous array reductions with zero HTML parsing. During `updatePost` (`src/modules/posts/services/post-command.service.ts`), the client never sends back existing image URLs or Cloudinary `public_id` strings; it sends `removeMediaIds` (referencing `post_media.id` UUIDs) and any newly uploaded files in the multipart `media` field. `postMediaService.diff` (`src/modules/posts/services/post-media.service.ts`) computes `keptMedia`, `addedMedia`, and `removedMedia` deterministically from database state.

### What this makes harder

PostgreSQL treats `content_document` as an opaque `jsonb` blob with a default of `'{"version":1,"blocks":[]}'::jsonb`. All structural validation, HTTP/HTTPS protocol checks on link nodes (`src/modules/articles/dtos/create-article.dto.ts`), and character counting must run in Zod schemas and command services before writing to the database.

Keeping `post_media` positions contiguous (`0..N-1`) under the unique index `post_media_post_position_uidx` also requires a two-step SQL update in `PostCommandService.updatePost` (`src/modules/posts/services/post-command.service.ts`): we first move all retained rows to `maxCurrentPosition + 10 + index` and then update them to `0..N-1` so PostgreSQL does not raise a unique constraint violation mid-loop.

### What this forecloses

Authors cannot currently place images inline between two paragraphs of a long-form Article; an Article only has a top-level cover image (`articles.cover_image_url`). Nor does `ContentDocument` (`version: 1`) have block types for headings, lists, or blockquotes yet.

Revisit by incrementing `ContentDocument` to `version: 2` (and adding an `article_media` table or validated image block reference) when the frontend editor adds rich formatting blocks and inline Article figures.

---

_Last verified against: v1.0.0 (12bc4d7, documentation branch, 2026-11-17)_
