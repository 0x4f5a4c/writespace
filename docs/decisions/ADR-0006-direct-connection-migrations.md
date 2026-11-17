---
description: Why drizzle.config.ts requires DATABASE_DIRECT_URL without falling back to DATABASE_URL and stores migration metadata in the drizzle schema.
---

# ADR-0006: Direct PostgreSQL Connection (`DATABASE_DIRECT_URL`) for Drizzle Migrations

- **Status:** Accepted
- **Date:** 2026-11-17 (decision made earlier; documented on this date — exact original decision date not recorded)
- **Deciders:** Afzal (single maintainer; all decisions in v1 were made by the sole developer)
- **Related:** [ADR-0009](ADR-0009-defer-pgbouncer-single-vm.md), [ADR-0010](ADR-0010-path-a-to-path-b-migration.md), [Migrations & Drizzle Kit](../data/migrations.md)

## Context

When running PostgreSQL behind a connection pooler in transaction-pooling mode (such as PgBouncer or managed cloud poolers in Path B), schema migrations (`CREATE TYPE`, `ALTER TABLE`, multi-statement DDL transactions, and session-level advisory locks) can fail or leave connections in an inconsistent state. Application runtime queries in `src/db/index.ts` use `DATABASE_URL`, which in a pooled deployment points to the pooler port.

If `drizzle.config.ts` used `DATABASE_URL` or fell back to `process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL`, a missing `DATABASE_DIRECT_URL` variable in CI or production would silently run DDL migrations through the transaction pooler. We also wanted Drizzle Kit's internal migration tracking table separated from application tables in the `public` schema.

## Options considered

| Option                                                                                                            | Summary                                                                                                                         | Why we accepted or rejected it                                                                                                                                                                            |
| :---------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Reuse `DATABASE_URL` (or fall back to it) and use `public.__drizzle_migrations`**                            | Point Drizzle Kit at `DATABASE_URL` if `DATABASE_DIRECT_URL` is unset, keeping migration history in `public`.                   | **Rejected.** A missing env var in a pooled environment would silently run migrations through PgBouncer, and keeping `__drizzle_migrations` in `public` mixes migration metadata with application tables. |
| **B. Require `DATABASE_DIRECT_URL` in `drizzle.config.ts` and isolate history in `drizzle.__drizzle_migrations`** | Fail fast if `DATABASE_DIRECT_URL` is missing and configure `migrations: { schema: "drizzle", table: "__drizzle_migrations" }`. | **Accepted.** Forces explicit migration connection configuration in every environment and keeps `public` clean.                                                                                           |

## Decision

In `drizzle.config.ts`, we require `process.env.DATABASE_DIRECT_URL` with zero fallback to `DATABASE_URL` and store migration state in `drizzle.__drizzle_migrations`:

```typescript
const databaseDirectUrl = process.env.DATABASE_DIRECT_URL;
if (!databaseDirectUrl) {
  throw new AppError(
    HTTP_STATUS.INTERNAL_SERVER_ERROR,
    "DATABASE_DIRECT_URL must be configured for Drizzle Kit operations.",
  );
}
```

## Consequences

### What this makes easy

Moving from our single-VM setup (Path A) to external managed PostgreSQL with connection pooling (Path B, see [ADR-0010](ADR-0010-path-a-to-path-b-migration.md)) requires zero changes to `drizzle.config.ts` or migration scripts—only setting `DATABASE_URL` to the pooled endpoint and `DATABASE_DIRECT_URL` to the direct PostgreSQL endpoint in `.env.production`.

### What this makes harder

Every local `.env` file (`.env.example`) and container definition (`docker-compose.yml`) must define both `DATABASE_URL` and `DATABASE_DIRECT_URL`, even though in local development and Path A single-VM production both variables contain the exact same connection string (see [ADR-0009](ADR-0009-defer-pgbouncer-single-vm.md)). Also note that a code comment in `drizzle.config.ts` states "The `writespace_migrator` role owns this schema", whereas `drizzle/0000_initial_schema.sql` currently runs under the default database user configured in `DATABASE_DIRECT_URL` (`> TODO(owner): verify whether a dedicated writespace_migrator role script will be added for Path B`).

### What this forecloses

You cannot run `npm run db:generate`, `npm run db:migrate`, `npm run db:push`, or `npm run studio` unless `DATABASE_DIRECT_URL` is set in `.env` or the shell environment.

---

_Last verified against: v1.0.0 (12bc4d7, documentation branch, 2026-11-17)_
