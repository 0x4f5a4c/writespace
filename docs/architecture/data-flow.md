---
description: End-to-end sequence diagrams tracing content creation with media rollback cleanup, outbox-driven notification delivery, and refresh token rotation.
---

# Request & Event Data Flow

> **Purpose:** Trace the exact runtime sequence of synchronous HTTP mutations, transactional outbox handoffs, asynchronous delivery leases, and session token rotation.
> **Audience:** Internal backend developers debugging request lifecycles or concurrency behavior.
> **Prerequisites:** Read [Component Breakdown (C4 L3)](components.md).

## Overview

Writespace separates synchronous user-facing mutations from asynchronous external side effects. Every mutating HTTP request validates its inputs, executes relational changes and counter updates inside a single PostgreSQL transaction, and — when `OUTBOX_PROCESSING_ENABLED=true` — persists a domain event in `outbox_events` before committing. External side effects (Cloudinary asset deletion, Socket.IO emissions, and SMTP emails) happen outside the database transaction so external network latency or failures never hold PostgreSQL row locks open.

## Flow 1: Content creation, mention outbox & media cleanup on rollback

When a user creates a Post (`POST /api/v1/posts/create`) or an Article (`POST /api/v1/articles/create`) with uploaded images, Multer streams the files to Cloudinary _before_ the database transaction begins (`src/shared/middlewares/upload.middleware.ts`). If the database transaction subsequently fails (for example, due to a duplicate Article `slug` or a nonexistent mentioned user UUID), the command service catches the error and enqueues the newly uploaded Cloudinary `publicId` values into `media-cleanup` so no orphaned files remain in cloud storage (`src/modules/posts/services/post-command.service.ts`, `src/modules/articles/services/article-command.service.ts`).

**Diagram: Synchronous Content Creation & Media Cleanup on Rollback**

```mermaid
sequenceDiagram
  autonumber
  actor Client as Writespace Client
  participant Multer as UploadMiddleware (Cloudinary)
  participant Ctrl as Posts/Articles Controller
  participant Cmd as CommandService
  participant PG as PostgreSQL (db.transaction)
  participant MQ as BullMQ (media-cleanup)

  Client->>Multer: POST /api/v1/posts/create (multipart/form-data)
  Multer->>Multer: Validate extension & MIME, stream to uploads/users/<userId>/
  Multer-->>Ctrl: Attach public_id & secure_url to req.files
  Ctrl->>Cmd: createPost(authorId, payload)
  Cmd->>Cmd: Validate char limit (<=6000) & folder prefix uploads/users/<userId>/
  Cmd->>PG: BEGIN TRANSACTION
  Cmd->>PG: Verify mentionedUserIds exist in users
  alt Validation or DB Insert Fails
    PG-->>Cmd: Rollback Transaction
    Cmd->>MQ: addMediaCleanupJob(publicIds)
    Cmd-->>Client: 400 / 409 / 500 Error Response
  else All Checks Pass
    Cmd->>PG: INSERT INTO content_items (contentType, authorId, status, ...)
    Cmd->>PG: INSERT INTO posts (id, contentDocument, tags)
    Cmd->>PG: INSERT INTO post_media (ordered positions 0..N-1)
    Cmd->>PG: INSERT INTO content_mentions (unique mentionedUserIds)
    opt status == "published" AND OUTBOX_PROCESSING_ENABLED == true
      Cmd->>PG: INSERT INTO outbox_events (mention.created per user)
    end
    Cmd->>PG: UPDATE users SET total_posts = total_posts + 1
    PG-->>Cmd: COMMIT TRANSACTION
    Cmd-->>Ctrl: Return postId
    Ctrl->>PG: postQueryService.getPost(postId, authorId)
    Ctrl-->>Client: 201 Created (ApiResponse with hydrated Post)
  end
```

## Flow 2: Two-stage transactional outbox to channel delivery

When a domain operation records an event in `outbox_events`, the durable notification pipeline processes it in two distinct outbox stages (`src/modules/notification/services/`):

- **Stage 1 (Domain Event → Inbox & Delivery Request):** `outboxDispatcherWorker` claims the domain event (e.g., `reaction.added`, `comment.created`, `auth.security_alert`) and enqueues `{ eventId }` into `notification-events-queue`. `notificationEventsWorker` calls `notificationProcessorService.process(eventId)`, which atomically records idempotency in `processed_events`, creates/updates the `notifications` and `notification_groups` rows, inserts a `queued` row into `notification_deliveries`, and inserts a second outbox event named `notification.delivery.requested` into `outbox_events`.
- **Stage 2 (Delivery Request → Channel Handler):** `outboxDispatcherWorker` claims the `notification.delivery.requested` outbox row and enqueues `{ eventId }` into `notification-delivery-events-queue`. `notificationDeliveryEventsWorker` calls `notificationDeliveryService.process(eventId)`, which claims a worker lease on `notification_deliveries`, runs a lease-renewal heartbeat (`leaseDurationMs / 3`), invokes `notificationRealtimeHandler` or `notificationEmailHandler` outside the DB transaction, and records the terminal outcome in `notification_delivery_attempts` and `notification_deliveries`.

**Diagram: Durable Outbox to Notification & Channel Delivery Flow**

```mermaid
sequenceDiagram
  autonumber
  participant Disp as OutboxDispatcherWorker
  participant PG as PostgreSQL
  participant EQ as BullMQ (Events & Delivery Queues)
  participant Proc as NotificationProcessorService
  participant Deliv as NotificationDeliveryService
  participant Chan as Realtime / Email Handler

  Disp->>PG: claimBatch() on outbox_events (status=PENDING -> PROCESSING)
  Disp->>EQ: Enqueue { eventId } to notification-events-queue
  Disp->>PG: markPublished(eventId) (status=PUBLISHED)
  EQ->>Proc: notificationEventsWorker invokes process(eventId)
  Proc->>PG: BEGIN TX: tryMarkProcessed("notification-inbox-processor", eventId)
  Proc->>PG: Verify live domain state & user preferences
  Proc->>PG: Insert/update notifications (& notification_groups if Post reaction)
  Proc->>PG: INSERT notification_deliveries (status="queued")
  Proc->>PG: INSERT outbox_events ("notification.delivery.requested")
  Proc->>PG: COMMIT TX (processed_events.outcome = "notification_created")
  Disp->>PG: claimBatch() ("notification.delivery.requested")
  Disp->>EQ: Enqueue { eventId } to notification-delivery-events-queue
  EQ->>Deliv: notificationDeliveryEventsWorker invokes process(eventId)
  Deliv->>PG: claimForProcessing() (status="processing", attempt=1, lease)
  par Heartbeat every leaseDurationMs / 3
    Deliv->>PG: renewLease(deliveryId, workerId, attemptNumber)
  and Channel Execution (Outside DB Transaction)
    Deliv->>Chan: deliver(context) (Socket.IO emit or SMTP sendEmail)
  end
  Deliv->>PG: completeAttempt() (status="accepted", clear lease)
```

## Flow 3: Refresh token rotation & reuse detection

When a client calls `POST /api/v1/auth/refresh-token`, `SessionService.rotateRefreshToken` hashes the incoming 64-hex-character token with SHA-256 and delegates to `RefreshTokenRepository.rotate` (`src/modules/sessions/refresh-token.repository.ts`).

**Diagram: Session Creation, Access Validation & Refresh Token Rotation**

```mermaid
sequenceDiagram
  autonumber
  actor Client as Web / Native Client
  participant Origin as TrustedOriginMiddleware
  participant Ctrl as AuthController
  participant Svc as SessionService
  participant Repo as RefreshTokenRepository
  participant PG as PostgreSQL (db.transaction)

  Client->>Origin: POST /api/v1/auth/refresh-token (Cookie or Body)
  Origin->>Origin: If refreshToken cookie present, verify Origin == CLIENT_URL
  Origin->>Ctrl: next()
  Ctrl->>Svc: rotateRefreshToken(rawRefreshToken)
  Svc->>Svc: Validate 64-hex format & compute SHA-256 tokenHash
  Svc->>Repo: rotate({ tokenHash, replacementTokenHash, now, idleTimeoutMs })
  Repo->>PG: SELECT refresh_tokens JOIN auth_sessions JOIN users FOR UPDATE
  alt Token Already Consumed (tokenConsumedAt IS NOT NULL)
    Repo->>PG: Set reuse_detected_at = now, revoke session & all session tokens
    Repo->>PG: securityEventRepository.create("refresh_token.reuse_detected")
    Repo-->>Ctrl: outcome: "reused"
    Ctrl-->>Client: 401 Unauthorized ("Refresh token reuse detected...")
  else Token Valid & Session Active
    Repo->>PG: INSERT successor refresh_tokens (parent_token_id = old.id)
    Repo->>PG: UPDATE old refresh_tokens SET consumed_at = now, replaced_by_token_id = new.id
    Repo->>PG: UPDATE auth_sessions SET last_seen_at = now, idle_expires_at = nextIdle
    Repo->>PG: securityEventRepository.create("refresh_token.rotated")
    Repo-->>Ctrl: outcome: "rotated" (new refreshToken + sessionId)
    Ctrl-->>Client: 200 OK (New Bearer accessToken + Cookie/Body refreshToken)
  end
```

## Key decisions & rationale

- **Why perform `bcrypt` hashing outside the database transaction in `resetPassword` and `updatePassword`?** In `AuthService.resetPassword` (`src/modules/auth/auth.service.ts`) and `UserService.updatePassword` (`src/modules/users/user.service.ts`), `await bcrypt.hash(password, 12)` is computed before opening `db.transaction(...)` and acquiring `FOR UPDATE` row locks on `auth_challenges` or `users`. This prevents CPU-intensive bcrypt hashing from holding database locks and blocking concurrent queries.
- **Why use BullMQ `moveToDelayed` + `DelayedError` in `notificationDeliveryEventsWorker`?** When a delivery fails transiently (`status === "RETRY_SCHEDULED"`) or is locked by another worker (`status === "WAITING"`), `notificationDeliveryEventsWorker` (`src/modules/notification/workers/notification-delivery-events.worker.ts`) calls `job.moveToDelayed(scheduledTimestamp, token)` and throws `new DelayedError()`. This reschedules the existing BullMQ job to the exact `nextAttemptAt` timestamp persisted in PostgreSQL without creating duplicate BullMQ jobs.

## Gotchas & edge cases

- **Password change race condition guard:** In `UserService.updatePassword` (`src/modules/users/user.service.ts`), because `bcrypt.compare` and `bcrypt.hash` run outside the transaction, the transaction re-reads `users` with `FOR UPDATE` and verifies `lockedUser.passwordHash === user.passwordHash`. If another request changed the password in the meantime, it aborts with `409 Conflict` (`"Your password has changed. Please try again."`).
- **Compacting `post_media.position` without violating the unique index:** When updating a Post's images in `PostCommandService.updatePost` (`src/modules/posts/services/post-command.service.ts`), retained media positions cannot be updated directly to `0..N-1` if an existing row already occupies one of those positions (`post_media_post_position_uidx`). The service first shifts all kept rows to `maxCurrentPosition + 10 + index` and then compacts them back to `0..N-1`.

## Related

- [Architecture Overview (C4 L1 & L2)](overview.md)
- [Component Breakdown (C4 L3)](components.md)
- [Background Jobs, Outbox & Queues](../backend/background-jobs-and-queues.md)
- [Authentication & Sessions](../modules/auth.md)

---

_Last verified against: v1.0.0 (12bc4d7, documentation branch, 2026-11-17)_
