---
description: Answers to frequent architectural and implementation questions about Writespace's data model, authentication, outbox, and notification pipelines.
---

# FAQ

> **Purpose:** Answer common engineering questions about why Writespace behaves the way it does, with direct pointers to the source files that enforce each rule.
> **Audience:** Internal backend developers and first-party client integrators.
> **Prerequisites:** Read [System Mental Model](overview.md) and [Domain Model & Entities](domain-model.md).

## Overview

This page answers recurring architectural and code-level questions encountered when working on Writespace. Every answer cites the exact repository, service, or schema file responsible for the behavior.

## Content & data model

### Why do `posts` and `articles` share UUIDs with `content_items`?

If Posts and Articles generated independent primary keys, every interaction table (`comments`, `content_reactions`, `content_saves`, `content_shares`, `content_mentions`) would need either nullable dual foreign keys (`post_id` / `article_id`) or polymorphic links without database referential integrity. By making `posts.id` and `articles.id` 1:1 primary-key/foreign-key references to `content_items.id` (`src/db/schema/content-items.ts`), PostgreSQL enforces foreign keys across all interaction tables using a single `content_item_id` column (see [ADR-0001](../decisions/ADR-0001-shared-content-identity.md)).

### Why are Post images stored in `post_media` instead of inside `content_document`?

Short Posts support up to 5 ordered image attachments (`MAX_POST_MEDIA = 5` in `src/modules/posts/services/post-media.service.ts`). Storing those attachments as rows in `post_media` with a unique `(post_id, position)` index (`src/db/schema/post-media.ts`) allows `PostCommandService` to validate Cloudinary folder ownership (`uploads/users/<userId>/`), enforce the 5-image limit, reorder retained images, and diff removed `public_id` values for asynchronous Cloudinary deletion without parsing or mutating the text document (see [ADR-0002](../decisions/ADR-0002-structured-content-document.md)).

### Why can't a published Article's `slug` be changed?

In `ArticleCommandService.updateArticle` (`src/modules/articles/services/article-command.service.ts`), changing `data.slug` when `currentStatus === "published"` throws `400 Bad Request` (`"Published Article slugs cannot be changed until URL redirects are supported"`). Draft and scheduled Articles can change their slug freely before publication.

### How does Writespace prevent two concurrent edits from overwriting a Post or Article?

`content_items` includes an integer `version` column (initialized to `1`). During `updatePost` (`src/modules/posts/services/post-command.service.ts`) and `updateArticle` (`src/modules/articles/services/article-command.service.ts`), the transaction first reads `contentItem.version` and executes `UPDATE content_items SET version = version + 1 ... WHERE id = :id AND version = :readVersion`. If zero rows are returned because a concurrent request committed first, the transaction aborts with `409 Conflict`.

## Authentication & sessions

### How does Writespace support both browser cookies and native mobile clients?

`getAuthSessionContext(req)` in `src/modules/auth/auth.controller.ts` inspects the `x-client-type` request header (`"web"` default, or `"native"`). When `clientType === "web"`, `verifyEmail`, `login`, and `refreshToken` set the `refreshToken` in an `HttpOnly` cookie and omit `refreshToken` from the JSON response body; `refreshToken` and `logout` endpoints also enforce `requireTrustedOriginForCookieAuth` (`src/shared/middlewares/trusted-origin.middleware.ts`). When `clientType === "native"`, the controller returns `refreshToken` in the JSON payload and reads it from `req.body.refreshToken`.

### Why does Google/GitHub OAuth reject sign-ins when an account with the same email already exists?

In `AuthService.handleSocialAuth` (`src/modules/auth/auth.service.ts`), OAuth accounts are looked up in `auth_identities` by `(provider, provider_subject)`. If no linked identity exists for that `provider_subject` but a `users` row already has the same `email`, `handleSocialAuth` throws `409 Conflict` (`"An account with this email already exists. Sign in using your existing authentication method."`). Automatic email-based linking is intentionally blocked to prevent pre-hijacking/account-takeover attacks before an authenticated account-linking flow exists.

### What happens if a stolen refresh token is used after the legitimate user has already rotated it?

`RefreshTokenRepository.rotate` (`src/modules/sessions/refresh-token.repository.ts`) locks the `refresh_tokens` row with `FOR UPDATE`. If `tokenConsumedAt` is already non-null, it records `reuse_detected_at = now`, revokes the parent `auth_sessions` row (`revoke_reason: "refresh_token_reuse"`), revokes every unrevoked token in that session, and writes a `refresh_token.reuse_detected` security event in the same transaction (which also triggers a mandatory high-priority security alert email and inbox notification).

## Outbox, queues & notifications

### What is the difference between `outbox_events` and `interaction_events`?

- `outbox_events` (`src/db/schema/outbox-events.ts`) is a **transactional outbox** committed atomically with domain writes when `OUTBOX_PROCESSING_ENABLED=true`. It drives the durable notification pipeline.
- `interaction_events` (`src/db/schema/interaction-events.ts`) is a **post-commit historical log** written via `interactionEventPublisher.publish` after the main transaction commits (`src/modules/interactions/events/interaction-event.publisher.ts`).

### Why are Post reactions grouped in the inbox while Article reactions are not?

In `NotificationProcessorService.buildPostReactionGroupingInput` (`src/modules/notification/services/notification-processor.service.ts`), when processing `reaction.added` on a `CONTENT_ITEM`, the processor queries `content_items.content_type`. Only when `contentType === "post"` does it group reactions into 5-minute UTC buckets (`POST_REACTION_GROUPING_WINDOW_MS = 300000` in `src/modules/notification/domain/notification-grouping.policy.ts`) via `notificationGroupRepository.addPostReactionToGroup`. Article reactions and comment reactions create individual `notifications` rows.

### If a user dismisses or deletes a grouped Post reaction notification, where do new reactions go?

`NotificationGroupRepository.addPostReactionToGroup` (`src/modules/notification/repositories/notification-group.repository.ts`) checks `findActivePresentation(transaction, existingGroup.id)` (`status = 'active' AND deleted_at IS NULL`). If the user dismissed or soft-deleted the existing inbox notification, the repository marks the old group `status = "closed"` (releasing the partial unique index `notification_groups_active_window_uq`) and creates a fresh active group and inbox notification for subsequent reactions.

### Why are suspended users still sent security alert emails?

In `NotificationEmailHandler.deliver` (`src/modules/notification/handlers/notification-email.handler.ts`), ordinary notification emails are suppressed (`notification_email_account_inactive`) when `recipient.status !== "active"`. However, when `notification.notificationType === "SECURITY_ALERT"`, the check is bypassed so a user whose account was just suspended (`account.suspended`) still receives the mandatory security notification explaining the suspension.

## Key decisions & rationale

- **Re-verifying domain state inside the notification consumer:** Because outbox events are processed asynchronously, a user might add a reaction or follow and immediately remove it milliseconds later. `NotificationProcessorService.buildNotification` (`src/modules/notification/services/notification-processor.service.ts`) queries `hasMatchingContentItemReaction`, `hasFollowRelationship`, `findCommentCreatedNotificationContext`, and `findMentionCreatedNotificationContext` before creating an inbox row, suppressing phantom notifications for undone actions.

## Gotchas & edge cases

- **`scheduled` content requires a future `scheduledAt`, but no scheduled-publisher worker exists yet:** Both `PostCommandService` and `ArticleCommandService` validate `scheduledAt > now` and `content_items` indexes `(status, scheduled_at)` (`content_items_status_scheduled_at_idx`), with a schema comment noting _"the publisher worker consumes it"_ (`src/db/schema/content-items.ts`). However, no background worker in `src/server.ts` currently transitions `scheduled` items to `published` automatically — see [Known Limitations & v1 Deferred Roadmap](../reference/limitations-and-roadmap.md).

## Related

- [System Mental Model](overview.md)
- [Domain Model & Entities](domain-model.md)
- [Glossary](glossary.md)
- [Notifications, Outbox & Realtime](../modules/notifications.md)

---

_Last verified against: v1.0.0 (12bc4d7, documentation branch, 2026-11-17)_
