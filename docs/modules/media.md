---
description: Cross-cutting guide to Cloudinary streaming uploads, Post and Article media synchronization, asynchronous asset cleanup, and Open Graph preview generation.
---

# Media & OG Image Handling

> **Purpose:** Document how Writespace handles image uploads, ownership verification, asynchronous Cloudinary cleanup, and social Open Graph previews across shared and module-level files.
> **Audience:** Internal backend developers working on file uploads, content attachments, or social sharing previews.
> **Prerequisites:** Read [Posts & Articles (Shared Content)](content.md) and [Component Breakdown (C4 L3)](../architecture/components.md).

## Overview

Writespace does not have a standalone `src/modules/media/` directory. Instead, media and social preview handling is distributed across four cooperating layers:

1. **Streaming Upload Middleware** (`src/shared/middlewares/upload.middleware.ts` & `src/shared/types/cloudinary-file.ts`)
2. **Module Media Services** (`src/modules/posts/services/post-media.service.ts` & `src/modules/articles/services/article-media.service.ts`)
3. **Asynchronous Asset Cleanup Queue** (`src/shared/queues/media.queue.ts` & `src/shared/queues/media.worker.ts`)
4. **Open Graph Preview & Image Generators** (`src/shared/utils/og-generator.ts`, `src/shared/middlewares/bot-interceptor.middleware.ts`, `post-preview.service.ts`, and `article-preview.service.ts`)

## 1. Cloudinary streaming upload middleware (`upload.middleware.ts`)

`src/shared/middlewares/upload.middleware.ts` configures a custom Multer `StorageEngine` (`CloudinaryStorageEngine`) that pipes incoming multipart file streams directly to `cloudinary.uploader.upload_stream`:

| Rule / Setting                      | Value / Behavior                                                                                                                                                                                                                         | Source                                               |
| :---------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------- |
| **Allowed Extensions**              | `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`                                                                                                                                                                                                 | `ALLOWED_IMAGE_EXTENSIONS` in `upload.middleware.ts` |
| **Allowed MIME Types**              | `image/jpeg`, `image/png`, `image/gif`, `image/webp` (both extension and MIME must match or `400 Bad Request` is thrown)                                                                                                                 | `ALLOWED_IMAGE_MIME_TYPES` in `upload.middleware.ts` |
| **Max File Size**                   | `env.MAX_FILE_SIZE_MB * 1024 * 1024` (default `5 MB` per file)                                                                                                                                                                           | `upload.middleware.ts`, `src/config/env.ts`          |
| **Max Files per Request**           | Global Multer limit: `env.MAX_FILES_PER_UPLOAD` (default `12`). Route field limits: `media` max `5` (`posts.routes.ts`), `coverImage` max `1` (`articles.routes.ts`), `profileImage` max `1` + `bannerImage` max `1` (`user.routes.ts`). | `upload.middleware.ts`, module route files           |
| **Cloudinary Folder & `public_id`** | Folder: `uploads/users/${req.user?.id \|\| "anonymous"}`. Public ID: `${Date.now()}-${cleanName}` (returned by Cloudinary as `uploads/users/<userId>/<timestamp>-<cleanName>`).                                                          | `CloudinaryStorageEngine._handleFile`                |
| **Attached File Properties**        | Attaches `location` (`secure_url`), `key` (`public_id`), `public_id`, `secure_url`, `path`, `filename`, and `size` (`CloudinaryFileFields`).                                                                                             | `src/shared/types/cloudinary-file.ts`                |

## 2. Ownership verification & diffing (`post-media.service.ts` & `article-media.service.ts`)

Because Multer uploads files to Cloudinary before the controller and command service run, both `PostCommandService` and `ArticleCommandService` enforce strict ownership and state diffing:

- **Account folder ownership check:** `assertMediaOwnedByUser` (`src/modules/posts/services/post-command.service.ts`) and `assertCoverImageOwnedByUser` (`src/modules/articles/services/article-command.service.ts`) verify that every newly attached `publicId` starts with `uploads/users/${userId}/`, throwing `403 Forbidden` if a caller attempts to attach another user's asset.
- **Post media diffing (`PostMediaService` in `src/modules/posts/services/post-media.service.ts`):**
  - Enforces `MAX_POST_MEDIA = 5` across `keptMedia.length + addedMedia.length`.
  - Rejects duplicate `publicId` values in `addedMedia` or duplicate UUIDs in `removeMediaIds`.
  - Verifies that every UUID in `removeMediaIds` actually belongs to `previousMedia` on that Post (`400 Bad Request`: `"One or more media attachments do not belong to this Post"`).
  - Extracts non-null `publicId` strings from `removedMedia` via `getRemovedPublicIds(diff)` so `PostCommandService` can enqueue them to `media-cleanup` after the transaction commits.
- **Article cover image diffing (`ArticleMediaService` in `src/modules/articles/services/article-media.service.ts`):**
  - Reconstructs `{ url, publicId, altText, credit }` from the four nullable columns on `articles` (`fromDatabase`). If `url` exists without `publicId` (or vice versa), or if `altText`/`credit` exist when no cover image is present, it throws `500 Internal Server Error` to flag database corruption.
  - Distinguishes metadata-only edits (`changed: true, assetChanged: false` when only `altText` or `credit` changed) from asset replacements or removals (`assetChanged: true`), ensuring `getRemovedPublicIds(diff)` only deletes the old Cloudinary asset when the image itself was replaced or removed.

## 3. Asynchronous Cloudinary cleanup (`media.queue.ts` & `media.worker.ts`)

Cloudinary deletions never run inside a database transaction:

- **Queue (`src/shared/queues/media.queue.ts`):** `MEDIA_QUEUE_NAME = "media-cleanup"`, configured with `attempts: env.MEDIA_QUEUE_ATTEMPTS` (default `3`), exponential backoff (`delay: env.QUEUE_BACKOFF_DELAY_MS`, default `1000ms`), `removeOnComplete: true`, and `removeOnFail: false`.
- **When cleanup jobs are enqueued:**
  1. **Transaction rollback on create or update:** If `createPost`, `updatePost`, `createArticle`, or `updateArticle` throws after Multer uploaded new files, the `catch` block enqueues the uncommitted `publicId` values so failed requests do not leak orphaned files in Cloudinary.
  2. **Media removal or replacement on update:** After the database transaction commits, removed `publicId` values from `postMediaService.getRemovedPublicIds` or `articleMediaService.getRemovedPublicIds` are enqueued.
  3. **Post or Article deletion:** `deletePost` and `deleteArticle` read the `publicId` values inside the transaction before `DELETE FROM content_items` cascades, and enqueue them immediately after commit.
- **Worker execution (`src/shared/queues/media.worker.ts`):** Runs with concurrency `env.MEDIA_WORKER_CONCURRENCY` (default `5`). It loops through `job.data.publicIds`, skips any invalid string starting with `"http"`, and calls `await cloudinary.uploader.destroy(publicId)`. If one asset in a batch fails, it continues attempting the remaining `publicIds` in the batch and throws an `Error` listing the failed IDs at the end so BullMQ retries the job.

## 4. Open Graph previews & dynamic PNG generation

Writespace provides three mechanisms for social-media link previews:

| Mechanism                                                    | Route / Middleware                                                                                                                             | How It Works                                                                                                                                                                                                                                                                                                             |
| :----------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Public Preview JSON APIs (for Next.js / Frontend SSR)** | `GET /api/v1/posts/public/:id/preview` (`post-preview.service.ts`), `GET /api/v1/articles/public/:slug/preview` (`article-preview.service.ts`) | Unauthenticated endpoints returning `{ id, canonicalPath, title, description, author, publishedAt, tags, image }` for `published` items only (`404` for drafts/scheduled). Cached with `Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=600`.                                                    |
| **2. Dynamic Profile OG PNG Generator (Satori + Resvg)**     | `GET /api/v1/users/og/:username` (`user.controller.ts` → `src/shared/utils/og-generator.ts`)                                                   | Fetches `Inter-SemiBold.otf` from jsDelivr (cached in `fontCache` `ArrayBuffer`), converts DiceBear `/svg` URLs to `/png`, renders a 1200x630 dark-slate (`#0f172a`) profile card to SVG via `satori`, rasterizes to PNG via `Resvg`, and streams `Content-Type: image/png` with `Cache-Control: public, max-age=86400`. |
| **3. Crawler HTML Bot Interceptor**                          | `botInterceptor` (`src/shared/middlewares/bot-interceptor.middleware.ts`)                                                                      | Matches `GET /post/:id` and `GET /profile/:username` when `User-Agent` contains crawler tokens (`twitterbot`, `facebookexternalhit`, `linkedinbot`, `whatsapp`, `slackbot`, `telegrambot`, `redditbot`, etc.) and returns a minimal HTML document containing escaped `og:*` and `twitter:*` meta tags.                   |

## Key decisions & rationale

- **Why allow `post_media.public_id` and `articles.cover_image_public_id` to be nullable in PostgreSQL?** Seed fixtures (`src/scripts/seed/content.seed.ts`) use external Unsplash URLs that are not stored in our Cloudinary account (`publicId: null`). Making `public_id` nullable in the database while requiring `publicId` on all newly uploaded `PostMediaItem` and `ArticleCoverImage` objects lets seeded demo content coexist with real Cloudinary uploads without `mediaWorker` trying to delete Unsplash URLs from Cloudinary.

## Gotchas & edge cases

- **`ArticleMediaService.fromDatabase` requires `coverImagePublicId` whenever `coverImageUrl` is set:** Wait—look closely at `src/modules/articles/services/article-media.service.ts`: `fromDatabase` checks `if (!url || !publicId) throw new AppError(500, "Article cover image is inconsistent: URL and publicId are required")`. Because `src/scripts/seed/content.seed.ts` seeds Articles with `coverImageUrl: topic.imageUrl` and `coverImagePublicId: null`, calling `PUT /api/v1/articles/:id` (`updateArticle`) on a **seeded** demo Article will trigger that `500` check in `articleMediaService.fromDatabase` unless `coverImagePublicId` is populated or the check is relaxed for seeded rows! (`GET` queries in `articleQueryService` read `coverImageUrl` directly without calling `fromDatabase`, so reading seeded Articles works fine.)
- **Broad Linux `User-Agent` match in `botInterceptor`:** `src/shared/middlewares/bot-interceptor.middleware.ts` includes `userAgent.includes("mozilla/5.0 (x11; ubuntu; linux")` in its `isBot` condition. Standard Ubuntu desktop browsers hitting the backend directly on `/post/:id` or `/profile/:username` will match `isBot` and receive the Open Graph HTML page.

## Related

- [Posts & Articles (Shared Content)](content.md)
- [Users & Social Graph](users.md)
- [Background Jobs, Outbox & Queues](../backend/background-jobs-and-queues.md)
- [Third-Party Integrations](../backend/third-party-integrations.md)

---

_Last verified against: v1.0.0 (b97c4fa, documentation branch, 2026-11-17)_
