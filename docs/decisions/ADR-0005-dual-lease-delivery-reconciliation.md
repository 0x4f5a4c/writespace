---
description: Why notification_deliveries uses separate worker and reconciliation leases and parks uncertain external attempts in an unknown state.
---

# ADR-0005: Dual-Lease Notification Delivery & Queue Reconciliation

- **Status:** Accepted
- **Date:** 2026-11-17 (decision made earlier; documented on this date — exact original decision date not recorded)
- **Deciders:** Afzal (single maintainer; all decisions in v1 were made by the sole developer)
- **Related:** [ADR-0003](ADR-0003-transactional-outbox-and-idempotency.md), [ADR-0004](ADR-0004-decoupled-notification-architecture.md), [Background Jobs, Outbox & Queues](../backend/background-jobs-and-queues.md), [Notification Delivery Reconciliation & Unknown Outcomes](../operations/runbooks/delivery-reconciliation.md)

## Context

In an asynchronous delivery pipeline backed by PostgreSQL and BullMQ (Redis), two classes of failures happen in production:

1. **Uncertain external execution:** A delivery worker claims a job to send an email via SMTP (`src/modules/notification/handlers/notification-email.handler.ts`). If the worker process is killed by SIGKILL, loses its database connection, or hits a socket timeout _after_ the SMTP `DATA` command has started, nobody knows whether the remote SMTP server accepted the message. If another worker reclaims the job and retries automatically, the user receives duplicate emails.
2. **Queue-to-database drift:** Because PostgreSQL and Redis are separate stores, a `notification_deliveries` row can remain in `status = 'queued'` or `'retryable_failed'` while its corresponding BullMQ job in `notification-delivery-events-queue` is missing (evicted or lost), stuck in BullMQ's `failed` set after exhausting queue-level retries, or prematurely marked `completed` in Redis.

If we used a single lock and a single `attempt_count` column for both channel execution and queue repair, every time a background reconciler repaired a missing BullMQ job, it would increment `attempt_count`—burning through the delivery's retry budget (`NOTIFICATION_QUEUE_ATTEMPTS = 2` in `src/config/env.ts`) before an SMTP or WebSocket handler ever ran.

## Options considered

| Option                                                                                                                  | Summary                                                                                                                                                                                                                                          | Why we accepted or rejected it                                                                                                                                                                                            |
| :---------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A. Trust BullMQ retries and stalled-job recovery alone**                                                              | Let BullMQ manage retries and stalled jobs in Redis without database leases.                                                                                                                                                                     | **Rejected.** BullMQ has no way to know whether a stalled worker crashed before or after sending an SMTP message, and if a Redis job is lost, nothing in BullMQ knows the PostgreSQL delivery row still needs processing. |
| **B. Automatically retry expired worker leases and all SMTP socket errors**                                             | If `lease_expires_at < now()` or Nodemailer throws `ETIMEDOUT`/`ESOCKET`, transition the delivery to `retryable_failed` and send it again.                                                                                                       | **Rejected.** Retrying after an expired worker lease or a mid-`DATA` socket drop violates at-most-once external side-effect safety for uncertain operations and can spam users with duplicate security alerts.            |
| **C. Dual leases (worker lease + reconciliation lease), separate counters, and explicit `ambiguous` / `unknown` state** | Track channel execution with `(locked_*, attempt_count)` and heartbeat renewal; track queue repair with `(reconciliation_locked_*, reconciliation_attempt_count)`; park expired worker leases and uncertain SMTP errors in `status = 'unknown'`. | **Accepted.** Separates queue repair from external provider attempts and refuses to blindly retry ambiguous external operations.                                                                                          |

## Decision

We designed `notification_deliveries` (`src/db/schema/notification-deliveries.ts`) around two independent leases enforced by PostgreSQL `CHECK` constraints (`notification_deliveries_lease_state_check` and `notification_deliveries_reconciliation_lease_state_check`):

1. **Worker execution lease (`locked_at`, `locked_by`, `lease_expires_at`, `attempt_count`):** `NotificationDeliveryRepository.claimForProcessing` (`src/modules/notification/repositories/notification-delivery.repository.ts`) locks the row `FOR UPDATE`, reads PostgreSQL `clock_timestamp()`, increments `attempt_count`, inserts a `processing` row into `notification_delivery_attempts`, and sets a 60-second lease (`NOTIFICATION_DELIVERY_LEASE_DURATION_MS`). While the channel handler runs outside the DB transaction, `NotificationDeliveryService.process` (`src/modules/notification/services/notification-delivery.service.ts`) runs a `setInterval` heartbeat every `Math.floor(leaseDurationMs / 3)` (20 seconds) calling `renewLease`.
2. **Ambiguous outcome preservation (`outcome: "ambiguous"` → `status: "unknown"`):** If `claimForProcessing`, `renewLease`, or `completeAttempt` encounters a `processing` row whose `lease_expires_at <= now`, `markExpiredLeaseAsUnknown` marks the active attempt `ambiguous` (`error_code: "worker_lease_expired"`) and transitions the delivery to `status = "unknown"`. Likewise, `classifySmtpError` (`src/modules/notification/handlers/notification-email.handler.ts`) only classifies SMTP errors as `transient_failure` when `smtpError.permanent === false` or when a connection/timeout failure occurred during a pre-`DATA` command (`CONN`, `EHLO`, `HELO`, `STARTTLS`, `AUTH *`, `MAIL FROM`, `RCPT TO`); all other socket drops or unrecognized exceptions return `outcome: "ambiguous"`, parking the delivery in `status = "unknown"`.
3. **Reconciliation lease (`reconciliation_locked_at`, `reconciliation_locked_by`, `reconciliation_lease_expires_at`, `reconciliation_attempt_count`):** Every 15 seconds (`NOTIFICATION_RECONCILIATION_INTERVAL_MS`), `NotificationReconciliationService.reconcile` (`src/modules/notification/services/notification-reconciliation.service.ts`) resolves expired processing leases, expires overdue deliveries (`expires_at <= now`), flags deliveries whose `outbox_events` row is `FAILED`, and claims due `queued` / `retryable_failed` deliveries past the 30-second initial grace period (`NOTIFICATION_RECONCILIATION_INITIAL_GRACE_PERIOD_MS`). It inspects `notificationDeliveryEventsQueue.getJob(jobId)` and recreates missing jobs, retries failed jobs, or removes-and-requeues inconsistent completed jobs while incrementing `reconciliation_attempt_count` (capped at `NOTIFICATION_RECONCILIATION_MAX_ATTEMPTS = 5`) instead of `attempt_count`.

## Consequences

### What this makes easy

A Redis restart or evicted BullMQ job self-heals within 15 to 45 seconds without inflating `notification_deliveries.attempt_count` or creating duplicate `notification_delivery_attempts` rows. At the same time, a worker crash mid-SMTP-send or a dropped connection during `DATA` is guaranteed never to trigger an automatic duplicate email.

### What this makes harder

The state machine in `src/modules/notification/repositories/notification-delivery.repository.ts` and `src/modules/notification/services/notification-delivery.service.ts` is complex. Every claim, renewal, and completion query must call `getDatabaseNow` (`SELECT clock_timestamp()`) after acquiring the row lock so clock drift between Node.js containers and PostgreSQL cannot cause false lease expirations. Furthermore, any delivery that lands in `status = 'unknown'` or exhausts its 5 reconciliation attempts (`reconciliation_attempt_count >= 5`) stays parked until an operator investigates it using [Notification Delivery Reconciliation & Unknown Outcomes](../operations/runbooks/delivery-reconciliation.md).

### What this forecloses

Channel handlers (`NotificationDeliveryHandler` in `src/modules/notification/contracts/delivery-handler.contract.ts`) cannot throw raw errors expecting BullMQ to retry them; any unhandled exception thrown by `handler.deliver()` is caught by `NotificationDeliveryService.process` (`src/modules/notification/services/notification-delivery.service.ts`) and converted into `{ outcome: "ambiguous", errorCode: "delivery_handler_unexpected_error" }`, which halts automatic retries. Handlers must return `{ outcome: "transient_failure" }` explicitly when—and only when—they can prove the external action did not take effect.

---

_Last verified against: v1.0.0 (12bc4d7, documentation branch, 2026-11-17)_
