# Table of contents

- [Writespace Engineering Documentation](README.md)

## Getting Started

- [Prerequisites](getting-started/prerequisites.md)
- [Installation & Local Setup](getting-started/installation.md)
- [5-Minute Quickstart](getting-started/quickstart.md)
- [Configuration & Environment Profiles](getting-started/configuration.md)
- [Project Tour](getting-started/project-tour.md)

## Core Concepts

- [System Mental Model](concepts/overview.md)
- [Domain Model & Entities](concepts/domain-model.md)
- [Glossary](concepts/glossary.md)
- [FAQ](concepts/faq.md)

## Architecture

- [Architecture Overview (C4 L1 & L2)](architecture/overview.md)
- [Component Breakdown (C4 L3)](architecture/components.md)
- [Request & Event Data Flow](architecture/data-flow.md)
- [Technology Stack & Rationale](architecture/tech-stack.md)
- [Deployment Topology (Path A)](architecture/deployment-topology.md)
- [Cross-Cutting Concerns](architecture/cross-cutting.md)
- [Master Diagram Index](architecture/diagrams.md)

## Codebase Guide

- [Repository Structure](codebase/repository-structure.md)
- [Module Ownership Map](codebase/module-map.md)
- [Entry Points & Server Lifecycle](codebase/entry-points.md)
- [Engineering Conventions](codebase/conventions.md)

## Application Modules

- [Authentication & Sessions](modules/auth.md)
- [Users & Social Graph](modules/users.md)
- [Posts & Articles (Shared Content)](modules/content.md)
- [Comments, Reactions, Saves & Shares](modules/interactions.md)
- [Notifications, Outbox & Realtime](modules/notifications.md)
- [Media & OG Image Handling](modules/media.md)
- [AI Integration (Gemini) — Coming in v2](modules/ai.md)

## Data & Storage

- [Database Schema Reference](data/schema.md)
- [Migrations & Drizzle Kit](data/migrations.md)
- [Deterministic Seeding & Fixtures](data/seed-and-fixtures.md)
- [Data Retention, Anonymization & PII](data/retention-and-pii.md)

## First-Party API Reference

- [API Overview & First-Party Scope](api/overview.md)
- [Frontend Authentication & Token Flow](api/authentication.md)
- [Authorization & Roles](api/authorization.md)
- [Error Envelope & Status Codes](api/errors.md)
- [Pagination, Filtering & Sorting](api/pagination-filtering-sorting.md)
- [Rate Limiting & Origin Security Controls](api/rate-limits.md)
- [Realtime Socket.IO Contract](api/realtime-events.md)
- [Endpoints Reference](api/endpoints/README.md)
  - [Notification & Preference Endpoints](api/endpoints/notifications.md)
  - [Auth & Session Endpoints](api/endpoints/auth.md)
  - [User & Follow Endpoints](api/endpoints/users.md)
  - [Post Endpoints](api/endpoints/posts.md)
  - [Article Endpoints](api/endpoints/articles.md)
  - [Interaction & Comment Endpoints](api/endpoints/interactions.md)
- [API Changelog](api/changelog.md)

## Backend Infrastructure

- [Backend Execution Model](backend/overview.md)
- [Transactional Services & Locking](backend/services.md)
- [Background Jobs, Outbox & Queues](backend/background-jobs-and-queues.md)
- [Redis Usage & Rate-Limit Store](backend/caching.md)
- [Third-Party Integrations](backend/third-party-integrations.md)

## Security

- [Threat Model](security/threat-model.md)
- [Secrets & Credential Hashing](security/secrets-management.md)
- [Data Protection, CSRF & Input Sanitization](security/data-protection.md)
- [Dependency & Vulnerability Policy](security/dependency-and-vuln-policy.md)

## Operations & Runbooks (Intended — Path A)

- [Environments (Local vs. OCI Single-VM)](operations/environments.md)
- [Build & Manual Deployment Workflow](operations/ci-cd.md)
- [Release & Rollback Process](operations/release-process.md)
- [Observability, Logging & Healthchecks](operations/observability.md)
- [Resource Budgeting, Performance & Scaling](operations/performance-and-scaling.md)
- [Backup, Recovery & Outbox Replay](operations/backup-and-recovery.md)
- [Runbooks](operations/runbooks/README.md)
  - [First Deploy on OCI Ampere A1 (Path A)](operations/runbooks/first-deploy.md)
  - [Outbox Dispatcher Stalled or Lease Expired](operations/runbooks/outbox-stalled.md)
  - [Notification Delivery Reconciliation & Unknown Outcomes](operations/runbooks/delivery-reconciliation.md)
  - [Database Connection Pool Exhaustion](operations/runbooks/db-pool-exhaustion.md)

## Architecture Decisions (ADRs)

- [ADR Index](decisions/README.md)
- [ADR-0001: Shared Content Identity (`content_items`)](decisions/ADR-0001-shared-content-identity.md)
- [ADR-0002: Structured JSONB `ContentDocument` & Externalized `post_media`](decisions/ADR-0002-structured-content-document.md)
- [ADR-0003: Transactional Outbox & Decoupled `processed_events`](decisions/ADR-0003-transactional-outbox-and-idempotency.md)
- [ADR-0004: Decoupled Notification Inbox, Grouping & Channel Deliveries](decisions/ADR-0004-decoupled-notification-architecture.md)
- [ADR-0005: Dual-Lease Notification Delivery & Queue Reconciliation](decisions/ADR-0005-dual-lease-delivery-reconciliation.md)
- [ADR-0006: Direct PostgreSQL Connection (`DATABASE_DIRECT_URL`) for Drizzle Migrations](decisions/ADR-0006-direct-connection-migrations.md)
- [ADR-0007: Server-Managed Sessions with Hashed Refresh Token Rotation](decisions/ADR-0007-session-and-refresh-token-rotation.md)
- [ADR-0008: Denormalized Counters Maintained Transactionally](decisions/ADR-0008-transactional-denormalized-counters.md)
- [ADR-0009: Defer PgBouncer in Single-VM Topology (Path A)](decisions/ADR-0009-defer-pgbouncer-single-vm.md)
- [ADR-0010: Single-VM (Path A) to Managed Services (Path B) Migration Strategy](decisions/ADR-0010-path-a-to-path-b-migration.md)

## Reference

- [Environment Variables](reference/env-vars.md)
- [NPM Scripts & CLI Commands](reference/cli-commands.md)
- [Configuration Files](reference/config-files.md)
- [Third-Party Dependencies & Licenses](reference/dependencies.md)
- [Known Limitations & v1 Deferred Roadmap](reference/limitations-and-roadmap.md)
- [Documentation Changelog](changelog.md)
