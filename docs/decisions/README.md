---
description: Index of Architecture Decision Records (ADRs) for the Writespace backend.
---

# Architecture Decision Records (ADRs)

An ADR records an architectural choice, the alternatives we rejected, and the trade-offs we accepted. Because Writespace was built by a single developer, these records keep the reasoning in the repository rather than inside one person's head.

**Status legend:** **Accepted** (implemented in the codebase), **Proposed** (decided for deployment or future cutover, not yet live), **Superseded** (replaced by a newer ADR).

| ADR                                                          | Title                                                                       | Status   | Decision Summary                                                                                                  |
| :----------------------------------------------------------- | :-------------------------------------------------------------------------- | :------- | :---------------------------------------------------------------------------------------------------------------- |
| [ADR-0001](ADR-0001-shared-content-identity.md)              | Shared Content Identity (`content_items`)                                   | Accepted | Share one UUID primary key between `content_items` and its `posts` or `articles` subtype row.                     |
| [ADR-0002](ADR-0002-structured-content-document.md)          | Structured JSONB `ContentDocument` & Externalized `post_media`              | Accepted | Store post and article bodies as versioned JSONB blocks while keeping Post images in `post_media`.                |
| [ADR-0003](ADR-0003-transactional-outbox-and-idempotency.md) | Transactional Outbox & Decoupled `processed_events`                         | Accepted | Write domain events to `outbox_events` in the business transaction and track consumer idempotency without an FK.  |
| [ADR-0004](ADR-0004-decoupled-notification-architecture.md)  | Decoupled Notification Inbox, Grouping & Channel Deliveries                 | Accepted | Separate `notifications` (inbox), `notification_groups` (aggregation), and `notification_deliveries` (transport). |
| [ADR-0005](ADR-0005-dual-lease-delivery-reconciliation.md)   | Dual-Lease Notification Delivery & Queue Reconciliation                     | Accepted | Use separate worker and reconciliation leases and mark uncertain transport failures as `unknown`.                 |
| [ADR-0006](ADR-0006-direct-connection-migrations.md)         | Direct PostgreSQL Connection (`DATABASE_DIRECT_URL`) for Drizzle Migrations | Accepted | Require `DATABASE_DIRECT_URL` in `drizzle.config.ts` and store migration history in the `drizzle` schema.         |
| [ADR-0007](ADR-0007-session-and-refresh-token-rotation.md)   | Server-Managed Sessions with Hashed Refresh Token Rotation                  | Accepted | Bind access JWTs to `auth_sessions` and rotate SHA-256 hashed refresh tokens on every use.                        |
| [ADR-0008](ADR-0008-transactional-denormalized-counters.md)  | Denormalized Counters Maintained Transactionally                            | Accepted | Maintain integer counters on `users`, `content_items`, and `comments` inside `FOR UPDATE` transactions.           |
| [ADR-0009](ADR-0009-defer-pgbouncer-single-vm.md)            | Defer PgBouncer in Single-VM Topology (Path A)                              | Proposed | Connect the single API container directly to local PostgreSQL (`DB_POOL_MAX=10`) without PgBouncer in v1.         |
| [ADR-0010](ADR-0010-path-a-to-path-b-migration.md)           | Single-VM (Path A) to Managed Services (Path B) Migration Strategy          | Proposed | Define the cutover procedure from co-located Docker Postgres/Redis to external managed instances.                 |

To add a new ADR, copy an existing `ADR-XXXX-<slug>.md` file, assign the next sequential four-digit number, and add a row to the table above.
