---
description: Why Writespace defers deploying PgBouncer in the v1 single-VM Oracle Cloud Always Free Ampere A1 deployment (Path A).
---

# ADR-0009: Defer PgBouncer in Single-VM Topology (Path A)

- **Status:** Proposed
- **Date:** 2026-11-17 (decision made earlier; documented on this date — exact original decision date not recorded)
- **Deciders:** Afzal (single maintainer; all decisions in v1 were made by the sole developer)
- **Related:** [ADR-0006](ADR-0006-direct-connection-migrations.md), [ADR-0010](ADR-0010-path-a-to-path-b-migration.md), [Deployment Topology (Path A)](../architecture/deployment-topology.md), [Resource Budgeting, Performance & Scaling](../operations/performance-and-scaling.md)

## Context

Comments in `drizzle.config.ts` explain that `DATABASE_DIRECT_URL` is separated from `DATABASE_URL` so schema migrations can bypass a PgBouncer transaction pooler. That separation was written with a multi-node or managed-database topology in mind.

For our v1 production launch (**Path A**), however, we are deploying the entire stack onto a single Oracle Cloud Infrastructure (OCI) Always Free Ampere A1 (ARM64) VM (~12 GB RAM allocation). One `writespace-api` container, one `postgres:18-alpine` container, and one `redis:7-alpine` container will share the internal Docker bridge network on that host. Because the HTTP server, Socket.IO server, outbox dispatcher, and BullMQ workers all run inside that single `writespace-api` Node.js process (`src/server.ts`), the entire application shares one `pg.Pool` instance (`src/db/index.ts`) configured with `DB_POOL_MIN=2` and `DB_POOL_MAX=10` (`src/config/env.ts`).

We had to decide whether to run a PgBouncer container in front of PostgreSQL on the single VM anyway, or skip it for v1.

## Options considered

| Option                                                                             | Summary                                                                                                                                  | Why we accepted or rejected it                                                                                                                                                                                                                                                                                                                    |
| :--------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A. Deploy PgBouncer on the single VM in v1**                                     | Run a fourth container (`pgbouncer`) on the OCI VM between `writespace-api` and `postgres:18-alpine`.                                    | **Rejected.** A single Node.js process with `DB_POOL_MAX=10` opens at most 10 connections against a local PostgreSQL container whose default `max_connections` is 100. Adding PgBouncer on the same host consumes RAM from our ~12 GB budget and adds another container healthcheck and failure point without saving a single backend connection. |
| **B. Defer PgBouncer in Path A and connect `pg.Pool` directly to `postgres:5432`** | Omit PgBouncer from the single-VM Docker Compose stack while keeping `DATABASE_URL` and `DATABASE_DIRECT_URL` distinct in configuration. | **Accepted.** Keeps the single-VM deployment simple while preserving the code boundary (`ADR-0006`) needed to turn pooling on later.                                                                                                                                                                                                              |

## Decision

We will not run PgBouncer in the v1 single-VM production topology (Path A). In `.env.production` on the OCI Ampere A1 host, both `DATABASE_URL` and `DATABASE_DIRECT_URL` will point directly to the co-located PostgreSQL container (`postgresql://<user>:<password>@postgres:5432/writespace`) over the internal Docker network, and `writespace-api` will manage connection pooling in-process via `pg.Pool` (`DB_POOL_MIN=2`, `DB_POOL_MAX=10` in `src/db/index.ts`).

## Consequences

### What this makes easy

We have only three Docker containers (`api`, `postgres`, `redis`) plus host Nginx to manage, monitor, and budget memory for on the ~12 GB VM. All Drizzle transactions, `FOR UPDATE` locks, and `clock_timestamp()` queries talk directly to PostgreSQL over loopback bridge networking with sub-millisecond latency and zero transaction-pooler quirks.

### What this makes harder

The maximum number of concurrent database queries across HTTP requests and background workers (`outboxDispatcherWorker`, `notificationEventsWorker`, `notificationDeliveryEventsWorker`, `notificationReconciliationWorker`) is bounded by `DB_POOL_MAX` (`10` by default). If slow queries or long transactions saturate all 10 connections for more than `DB_CONNECTION_TIMEOUT_MS` (`10000ms` in `src/config/env.ts`), incoming requests will fail with pool timeout errors (see [Database Connection Pool Exhaustion](../operations/runbooks/db-pool-exhaustion.md)).

### What this forecloses

We cannot scale `writespace-api` horizontally to multiple container replicas or split background workers into separate processes/hosts with high `DB_POOL_MAX` values until we either introduce PgBouncer or migrate to external managed PostgreSQL with built-in pooling.

Revisit when we scale beyond a single `writespace-api` container, when we split BullMQ workers into separate containers, or when we migrate from Path A to Path B ([ADR-0010](ADR-0010-path-a-to-path-b-migration.md)).

---

_Last verified against: v1.0.0 (12bc4d7, documentation branch, 2026-11-17)_
