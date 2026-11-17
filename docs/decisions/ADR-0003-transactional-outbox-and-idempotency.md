---
description: Why Writespace writes domain events to a PostgreSQL transactional outbox and omits foreign keys from processed_events.
---

# ADR-0003: Transactional Outbox & Decoupled `processed_events`

- **Status:** Accepted
- **Date:** 2026-11-17 (decision made earlier; documented on this date — exact original decision date not recorded)
- **Deciders:** Afzal (single maintainer; all decisions in v1 were made by the sole developer)
- **Related:** [ADR-0004](ADR-0004-decoupled-notification-architecture.md), [ADR-0005](ADR-0005-dual-lease-delivery-reconciliation.md), [Background Jobs, Outbox & Queues](../backend/background-jobs-and-queues.md)

## Context

When a user comments on an article, reacts to a post, follows another developer, mentions someone, or triggers an account security event (such as `password.reset` or `refresh_token.reuse_detected`), the backend must update PostgreSQL and trigger asynchronous work in BullMQ (Redis).

PostgreSQL and Redis do not share a transaction. In our earlier implementation—which still survives for the best-effort `interaction_events` history table (`src/modules/interactions/events/interaction-event.publisher.ts`) and the legacy `email-queue` (`src/modules/notification/notification.service.ts`)—services committed their PostgreSQL transaction first and then called Redis or a secondary repository in a `try / catch` block. If the Node.js process crashed or Redis timed out after the PostgreSQL `COMMIT`, the side effect was lost. Conversely, enqueueing a BullMQ job _before_ the PostgreSQL transaction commits risks a worker picking up the job before the row is visible or after the transaction rolls back.

For user notifications and mandatory security alerts (`src/modules/sessions/security-event.repository.ts`), silently dropping events on a Redis hiccup was not acceptable. At the same time, an outbox dispatcher can crash after handing a job to BullMQ (`publishToQueue` in `src/modules/notification/services/outbox-dispatcher.service.ts`) but before marking the outbox row `PUBLISHED` in PostgreSQL. That makes the outbox-to-BullMQ handoff at-least-once, meaning downstream consumers must be idempotent.

## Options considered

| Option                                                                                                   | Summary                                                                                                                                                                                                            | Why we accepted or rejected it                                                                                                                                                                                                                                                                         |
| :------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Direct post-commit `queue.add()` to BullMQ**                                                        | Commit the PostgreSQL transaction, then call `notificationEventsQueue.add()` directly from the service layer.                                                                                                      | **Rejected.** If Redis is unreachable or the process restarts between `COMMIT` and `queue.add()`, the notification or security alert is permanently lost.                                                                                                                                              |
| **B. PostgreSQL `LISTEN / NOTIFY`**                                                                      | Emit `NOTIFY` inside the transaction and have a worker listen on a persistent connection.                                                                                                                          | **Rejected.** PostgreSQL `NOTIFY` messages are not durable; any event emitted while the worker connection is reconnecting is dropped.                                                                                                                                                                  |
| **C. Transactional `outbox_events` + `processed_events` with an FK to `outbox_events.id`**               | Write events to `outbox_events` in the same transaction, poll them into BullMQ, and track consumer idempotency in `processed_events` with a foreign key to `outbox_events(id)`.                                    | **Rejected.** Tying `processed_events.event_id` to `outbox_events.id` with a foreign key forces both tables to share the same retention window. Deleting old `PUBLISHED` rows from `outbox_events` would either fail or cascade-delete the idempotency markers needed to block delayed duplicate jobs. |
| **D. Transactional `outbox_events` + FK-free `processed_events` + minimal `{ eventId }` queue payloads** | Write validated events to `outbox_events` in the caller's transaction, dispatch `{ eventId }` to BullMQ under a database lease, and track `(consumer_name, event_id)` in `processed_events` without a foreign key. | **Accepted.** Guarantees atomic event persistence, keeps sensitive payloads out of Redis, and decouples outbox cleanup from idempotency retention.                                                                                                                                                     |

## Decision

We introduced `outbox_events` (`src/db/schema/outbox-events.ts`) and `processed_events` (`src/db/schema/processed-events.ts`). Domain services pass their active `DatabaseTransaction` into `eventPublisherService.recordInTransaction(tx, input)` (`src/modules/notification/services/event-publisher.service.ts`), which validates the payload against `eventRegistry` (`src/modules/notification/events/event.registry.ts`) and inserts a `PENDING` row into `outbox_events` before the transaction commits.

`outboxDispatcherWorker` (`src/modules/notification/workers/outbox-dispatcher.worker.ts`) polls PostgreSQL every `OUTBOX_DISPATCHER_POLL_INTERVAL_MS` (`1000ms`), claims up to `OUTBOX_DISPATCHER_BATCH_SIZE` (`25`) rows using a 60-second lease (`locked_by`, `lease_expires_at`), and enqueues only `{ eventId: event.id }` into BullMQ using a deterministic `jobId` (`notification-event-${event.id}` or `notification-delivery-event-${event.id}`).

When `notificationProcessorService.process(eventId)` (`src/modules/notification/services/notification-processor.service.ts`) runs, its first statement inside `db.transaction` is `processedEventRepository.tryMarkProcessed(transaction, "notification-inbox-processor", eventId)` (`src/modules/notification/repositories/processed-event.repository.ts`), which inserts `{ consumerName, eventId, outcome: "processing" }` with `ON CONFLICT DO NOTHING` and updates `outcome` to its terminal value (`notification_created`, `group_updated`, or `no_delivery_required`) before committing.

## Consequences

### What this makes easy

If a domain transaction rolls back, its `outbox_events` row rolls back with it. If Redis is down when a user logs in or comments, the HTTP request still succeeds and the `PENDING` row waits in PostgreSQL until Redis recovers. Because BullMQ jobs in `src/shared/queues/notification-events.queue.ts` and `notification-delivery-events.queue.ts` only carry `{ eventId: string }`, no email addresses, message bodies, or user metadata ever sit in Redis job payloads. Leaving the foreign key off `processed_events.event_id` lets us vacuum old `PUBLISHED` rows from `outbox_events` without losing the idempotency record that guards against a delayed replay.

### What this makes harder

Every notification incurs a polling delay of up to `OUTBOX_DISPATCHER_POLL_INTERVAL_MS` (1 second by default) for the domain event handoff, plus a second outbox handoff for `notification.delivery.requested` (`src/modules/notification/services/notification-processor.service.ts`). In addition, `OUTBOX_PROCESSING_ENABLED` defaults to `"false"` in `src/config/env.ts` so a fresh database without migrations applied does not crash on boot. If a developer or operator forgets to set `OUTBOX_PROCESSING_ENABLED=true` after migrating, interaction services (`src/modules/interactions/services/reaction.service.ts`, `comment.service.ts`, `follow.service.ts`, `save.service.ts`, `share.service.ts`) skip writing domain events and `src/server.ts` leaves the four notification workers stopped.

### What this forecloses

We cannot add a new domain event by simply calling `queue.add()` in a service; every new event must be added to `DOMAIN_EVENT_NAMES` (`src/modules/notification/domain/event-name.ts`), given a Zod schema in `src/modules/notification/events/event.schemas.ts`, registered in `eventRegistry` (`src/modules/notification/events/event.registry.ts`), and handled in the exhaustive `switch (event.eventName)` statement inside `NotificationProcessorService.buildNotification` (`src/modules/notification/services/notification-processor.service.ts`).

---

_Last verified against: v1.0.0 (12bc4d7, documentation branch, 2026-11-17)_
