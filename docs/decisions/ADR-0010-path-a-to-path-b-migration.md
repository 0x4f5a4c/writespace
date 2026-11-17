---
description: How Writespace will migrate from the v1 single-VM Oracle Cloud deployment (Path A) to external managed PostgreSQL and Redis (Path B).
---

# ADR-0010: Single-VM (Path A) to Managed Services (Path B) Migration Strategy

- **Status:** Proposed
- **Date:** 2026-11-17 (decision made earlier; documented on this date — exact original decision date not recorded)
- **Deciders:** Afzal (single maintainer; all decisions in v1 were made by the sole developer)
- **Related:** [ADR-0003](ADR-0003-transactional-outbox-and-idempotency.md), [ADR-0005](ADR-0005-dual-lease-delivery-reconciliation.md), [ADR-0006](ADR-0006-direct-connection-migrations.md), [ADR-0009](ADR-0009-defer-pgbouncer-single-vm.md), [Deployment Topology (Path A)](../architecture/deployment-topology.md), [Backup, Recovery & Outbox Replay](../operations/backup-and-recovery.md)

## Context

For v1, Writespace is planned to run on **Path A**: a single Oracle Cloud Infrastructure (OCI) Always Free Ampere A1 (ARM64) VM (~12 GB RAM) hosting Nginx on the host OS and `writespace-api`, `postgres:18-alpine`, and `redis:7-alpine` in Docker Compose. Running everything on one Always Free VM keeps infrastructure cost at zero while the project is maintained by a solo developer.

However, `docker-compose.prod.yml` in the repository was written for **Path B** (external managed PostgreSQL and Redis): it defines only the `api` container (`writespace-api:production`) and expects `DATABASE_URL`, `DATABASE_DIRECT_URL`, and `REDIS_URL` in `.env.production` to point to external services. Path A also carries inherent single-VM trade-offs: there is no automatic failover, host maintenance causes downtime, backups (`pg_dump`) are our own responsibility, and Node.js, PostgreSQL, and Redis must share ~12 GB of RAM.

We needed to structure Path A so that when traffic or reliability requirements outgrow the single VM, cutting over to Path B requires zero application code changes and no loss of durable data, sessions, or notifications.

## Options considered

| Option                                                                                                                                      | Summary                                                                                                                                                                                                                                       | Why we accepted or rejected it                                                                                                                                   |
| :------------------------------------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Deploy v1 directly on Path B (managed cloud Postgres + managed Redis)**                                                                | Pay for external managed PostgreSQL and Redis from day one and use `docker-compose.prod.yml` as-is.                                                                                                                                           | **Rejected.** Adds recurring monthly hosting costs before the platform has external users, when a ~12 GB ARM64 VM on OCI Always Free is more than enough for v1. |
| **B. Hardcode single-VM container assumptions into application code and `docker-compose.prod.yml`**                                         | Strip `DATABASE_DIRECT_URL` and `rediss://` TLS support and hardcode local container hostnames.                                                                                                                                               | **Rejected.** Forces code and config rewrites under pressure when we eventually need to move PostgreSQL or Redis off the VM.                                     |
| **C. Run Path A via Compose service additions (`[PROPOSED]`) while preserving Path B configuration seams for a dump-and-cutover migration** | Add internal-only `postgres` and `redis` services for Path A, and use PostgreSQL's transactional outbox (`outbox_events`) and delivery ledger (`notification_deliveries`) as the single durable state to migrate when cutting over to Path B. | **Accepted.** Gives us a zero-cost v1 deployment and a deterministic 5-step cutover to managed infrastructure later.                                             |

## Decision

We will deploy v1 on **Path A** by adding internal-only `postgres:18-alpine` and `redis:7-alpine` services (with no published host ports and explicit `mem_limit` budgets) alongside `docker-compose.prod.yml` (see [Deployment Topology (Path A)](../architecture/deployment-topology.md)).

Meanwhile, all Path B seams remain intact in the codebase:

- `drizzle.config.ts` requires `DATABASE_DIRECT_URL` (`ADR-0006`) so migrations can bypass a managed PgBouncer endpoint while `src/db/index.ts` uses `DATABASE_URL`.
- `src/config/bullmq.ts` supports both `redis://` and TLS-enabled `rediss://` URLs (`...(redisProtocol === "rediss:" ? { tls: {} } : {})`), as well as `REDIS_PASSWORD` and database path numbers, so switching to a managed TLS Redis instance requires only a URL change in `.env.production`.

When we migrate from Path A to Path B, we will execute this five-step cutover during a scheduled maintenance window:

1. **Provision Path B stores:** Provision managed PostgreSQL 18 (with both a pooled `DATABASE_URL` and a direct `DATABASE_DIRECT_URL`) and managed Redis 7 (`rediss://`), restricting their firewall/security-group ingress to the OCI VM's IP.
2. **Stop the API and drain workers:** Run `docker compose -f docker-compose.prod.yml stop api` on the VM. In `src/server.ts`, `SIGTERM` triggers `gracefulShutdown`, which closes Socket.IO/HTTP, stops `outboxDispatcherWorker` and `notificationReconciliationWorker` first, waits up to `SHUTDOWN_TIMEOUT_MS` (`120000ms`) for active BullMQ workers to finish in-flight jobs, and closes Redis and PostgreSQL connections cleanly.
3. **Dump and restore PostgreSQL:** Run `pg_dump -U writespace -Fc writespace` from the local `postgres` container and `pg_restore --no-owner --no-acl -d "$DATABASE_DIRECT_URL"` into the managed PostgreSQL database, then verify row counts across `users`, `content_items`, `auth_sessions`, `outbox_events`, and `notification_deliveries`.
4. **Skip Redis data migration (rely on PostgreSQL reconciliation):** Because `outbox_events` (`ADR-0003`) and `notification_deliveries` (`ADR-0005`) persist all durable event and delivery state in PostgreSQL, we do not need to copy Redis RDB/AOF files to the managed Redis service. Any `PENDING` outbox rows will be dispatched by `outboxDispatcherWorker` on boot, and any `queued` or `retryable_failed` deliveries whose BullMQ jobs were in the old Redis instance will be recreated automatically by `notificationReconciliationWorker` (`src/modules/notification/services/notification-reconciliation.service.ts`).
5. **Switch `.env.production` and restart on base `docker-compose.prod.yml`:** Update `DATABASE_URL`, `DATABASE_DIRECT_URL`, `REDIS_URL`, and `REDIS_PASSWORD` in `.env.production`, start the `api` container using the unmodified `docker-compose.prod.yml` (without the local `postgres` and `redis` containers), verify `GET /health`, and archive a final snapshot of the local `postgres_data_v18` volume before removing it.

## Consequences

### What this makes easy

We pay nothing for managed database or Redis hosting in v1, and we do not have to touch a single line of TypeScript when moving to Path B. Because `notificationReconciliationWorker` (`ADR-0005`) treats PostgreSQL as the source of truth and BullMQ as an ephemeral execution mechanism, pointing the app at a fresh managed Redis instance during cutover self-heals any undelivered notification jobs without manual queue export scripts.

### What this makes harder

While running on Path A, we are the database administrator: if we do not configure and test nightly `pg_dump` backups and offsite copies (see [Backup, Recovery & Outbox Replay](../operations/backup-and-recovery.md)), a corrupted block volume on the OCI VM loses data. During the Path A → Path B cutover itself, the platform will be offline for the duration of `pg_dump` and `pg_restore`. In addition, three categories of short-lived Redis-only state will be reset when switching to a fresh managed Redis instance:

- in-flight registration OTPs (`auth:register:<email>`, 10-minute TTL in `src/modules/auth/auth.service.ts`),
- in-flight OAuth2 state bindings (`oauth:state:<provider>:<hash>`, 5-minute TTL in `src/modules/auth/oauth-state.store.ts`), and
- sliding rate-limit counters (`rl:*`, 10-to-60-minute windows in `src/shared/middlewares/rate-limit.middleware.ts`), along with any unconsumed jobs in the legacy `email-queue` or `media-cleanup` queue that were not drained during step 2.

### What this forecloses

This cutover strategy assumes a brief maintenance window (`docker compose stop api`) is acceptable. It does not set up PostgreSQL logical replication for a zero-downtime live cutover.

Revisit and execute the Path A → Path B migration when single-VM memory usage consistently exceeds 80% of the ~12 GB RAM allocation, when CPU contention between Node.js and PostgreSQL degrades API latency, or when we need to run multiple `writespace-api` containers behind a load balancer.

---

_Last verified against: v1.0.0 (12bc4d7, documentation branch, 2026-11-17)_
