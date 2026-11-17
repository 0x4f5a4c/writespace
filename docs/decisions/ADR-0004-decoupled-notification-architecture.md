---
description: Why Writespace separates in-app inbox notifications, time-windowed notification groups, and channel delivery records into distinct tables.
---

# ADR-0004: Decoupled Notification Inbox, Grouping & Channel Deliveries

- **Status:** Accepted
- **Date:** 2026-11-17 (decision made earlier; documented on this date — exact original decision date not recorded)
- **Deciders:** Afzal (single maintainer; all decisions in v1 were made by the sole developer)
- **Related:** [ADR-0003](ADR-0003-transactional-outbox-and-idempotency.md), [ADR-0005](ADR-0005-dual-lease-delivery-reconciliation.md), [Notifications, Outbox & Realtime](../modules/notifications.md)

## Context

A naive notification design stores everything in one `notifications` table with columns like `read_at`, `email_sent_at`, and `realtime_sent_at`. That single-table model broke down as soon as we had to support three concrete requirements in Writespace:

1. **Burst aggregation on Post reactions:** When a Post gets 20 `"like"` reactions in three minutes, inserting 20 separate rows into the author's in-app inbox ruins the notification dropdown. We wanted reactions of the same `reactionType` on the same Post within a 5-minute UTC window (`POST_REACTION_GROUPING_WINDOW_MS = 300000` in `src/modules/notification/domain/notification-grouping.policy.ts`) to roll up into a single inbox item displaying the 3 most recent actors (`GROUPED_NOTIFICATION_ACTOR_DISPLAY_LIMIT = 3`) and a total `group_count`, while keeping Article reactions and comments as individual inbox rows.
2. **Independent inbox lifecycle vs. group lifecycle:** Users can dismiss (`POST /api/v1/notifications/:notificationId/dismiss`), restore (`POST /api/v1/notifications/:notificationId/restore`), or soft-delete (`DELETE /api/v1/notifications/:notificationId`) an inbox notification (`src/modules/notification/notification.routes.ts`). If a user dismisses or deletes an active grouped notification two minutes into a 5-minute window, a new reaction arriving in minute three must not resurrect the dismissed item or silently disappear; it needs to close the old group and open a new active group.
3. **One-to-many channel deliveries:** A single grouped `notifications` row triggers an initial `realtime` delivery (`notification.created`) when created, and a new `realtime` delivery (`notification.updated`) every time another user reacts within that 5-minute window (`src/modules/notification/handlers/notification-realtime.handler.ts`). Mandatory security alerts (`auth.security_alert`) trigger both a `realtime` delivery and an `email` delivery (`src/modules/notification/services/notification-processor.service.ts`). Meanwhile, our schema also supports future digest or email-only notifications where `notification_deliveries.notification_id` is `NULL` (`src/db/schema/notification-deliveries.ts`).

## Options considered

| Option                                                                                                                                                                                   | Summary                                                                                                                     | Why we accepted or rejected it                                                                                                                                                                                                                                                                                  |
| :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Single `notifications` table with inline delivery timestamps and `actor_ids[]` array**                                                                                              | Store `email_sent_at`, `realtime_sent_at`, and an array of actor UUIDs directly on `notifications`.                         | **Rejected.** Cannot record multiple `realtime` deliveries for successive updates to a grouped notification, cannot store per-attempt SMTP error codes or latencies, and cannot prevent a retried event from incrementing `group_count` twice without a separate membership table.                              |
| **B. Compute grouping dynamically at `GET /api/v1/notifications` read time**                                                                                                             | Insert every reaction as its own row in `notifications` and use `GROUP BY` window functions during inbox queries.           | **Rejected.** Keyset cursor pagination (`created_at DESC, id DESC` in `src/modules/notification/repositories/notification.repository.ts`), unread badge counts (`notifications_active_unread_idx`), and per-item dismiss/delete operations become slow and ambiguous when inbox IDs are synthesized on the fly. |
| **C. Separate `notifications` (inbox), `notification_groups` + `notification_group_events` (aggregation), and `notification_deliveries` + `notification_delivery_attempts` (transport)** | Materialize inbox items, 5-minute group state, group event memberships, and per-channel delivery state in dedicated tables. | **Accepted.** Keeps inbox queries fast (`SELECT` with two `LEFT JOIN`s), enforces group membership uniqueness at the database level, and gives every channel delivery its own state machine.                                                                                                                    |

## Decision

We split the notification domain into three decoupled table groups in `src/db/schema/`:

1. **Inbox presentation (`notifications` in `src/db/schema/notifications.ts`):** Represents what the user sees in the app (`status`: `active`, `archived`, `dismissed`; `read_at`; soft-delete `deleted_at`; `dedupe_key`).
2. **Activity aggregation (`notification_groups` and `notification_group_events` in `src/db/schema/notification-groups.ts`, `notification-group-events.ts`):** Tracks 5-minute UTC buckets per `(recipient_user_id, grouping_key, grouping_window_start)` enforced by a partial unique index `WHERE status = 'active'`. Each contributing event is recorded in `notification_group_events` with a unique index on `(group_id, source_event_id)`.
3. **Channel delivery (`notification_deliveries` and `notification_delivery_attempts` in `src/db/schema/notification-deliveries.ts`, `notification-delivery-attempts.ts`):** Tracks each transport request (`realtime`, `email`, `browser_push`) with a unique `idempotency_key` (`${channel}:${event.id}:${notification.id}`) and a child row per attempt.

## Consequences

### What this makes easy

`NotificationRepository.listInbox` (`src/modules/notification/repositories/notification.repository.ts`) is a straightforward index scan over `notifications_recipient_created_id_idx` with a `LEFT JOIN` to `users` and `notification_groups`. In `NotificationGroupRepository.addPostReactionToGroup` (`src/modules/notification/repositories/notification-group.repository.ts`), if the user has dismissed or soft-deleted the inbox presentation for an active group (`findActivePresentation` returns `null`), `closeGroup` flips `notification_groups.status` to `'closed'`—which releases the partial unique index `notification_groups_active_window_uq`—and creates a brand-new group and inbox row in the same time bucket. Soft-deleting an inbox row (`deleted_at = now`) also preserves all historical `notification_deliveries` and `notification_delivery_attempts` rows for operational auditing.

### What this makes harder

Write amplification on notification creation is higher. Processing a single grouped Post reaction in `NotificationProcessorService.process` (`src/modules/notification/services/notification-processor.service.ts`) touches `processed_events`, `notification_groups`, `notification_group_events`, `notifications`, `notification_deliveries`, and `outbox_events` inside one transaction, and runs a window-function subquery (`ROW_NUMBER() OVER (PARTITION BY actor_user_id ORDER BY occurred_at DESC)`) in `findGroupActorPreviews` to refresh the 3-actor preview in `presentation_data`.

Additionally, although the database schema already defines `notification_user_settings` (`quiet_hours_enabled`, `quiet_hours_start`, `quiet_hours_end` in `src/db/schema/notification-user-settings.ts`), `notification_suppressions` (`src/db/schema/notification-suppressions.ts`), and `daily_digest` / `weekly_digest` / `browser_push` values in `notification_preferences` (`src/db/schema/notification-preferences.ts`), only `in_app` category preferences (`src/modules/notification/notification-preference.controller.ts`) and `realtime` + `email` handlers are wired in v1 (`src/modules/notification/workers/notification-delivery-events.worker.ts`).

### What this forecloses

Channel handlers cannot mutate inbox state, and inbox mutations (`markAsRead`, `dismiss`, `deleteNotification`) never cancel or delete historical delivery records. Instead, `NotificationRealtimeHandler.deliver` (`src/modules/notification/handlers/notification-realtime.handler.ts`) checks `notification.status !== "active" || notification.deletedAt !== null` at delivery time and records `outcome: "suppressed"` (`errorCode: "notification_realtime_notification_inactive"`) if the user dismissed or deleted the inbox item before the WebSocket worker ran.

---

_Last verified against: v1.0.0 (12bc4d7, documentation branch, 2026-11-17)_
