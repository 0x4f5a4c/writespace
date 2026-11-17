---
description: Boot Writespace locally, seed deterministic demo data, and execute your first authenticated API calls in under 5 minutes.
---

# 5-Minute Quickstart

> **Purpose:** Get a new developer from a fresh clone to a running, seeded Writespace backend with verified HTTP and authentication responses in 5 minutes.
> **Audience:** New internal developers and first-party client integrators.
> **Prerequisites:** Docker Desktop (or Node.js 24 + PostgreSQL + Redis) installed; see [Prerequisites](prerequisites.md).

## Overview

This quickstart uses the Docker Compose workflow to launch the Express 5 + Socket.IO server, PostgreSQL 18, and Redis 7, apply the baseline schema (`drizzle/0000_initial_schema.sql`), populate deterministic demo fixtures (`src/scripts/seed/index.ts`), and test the running API on `http://localhost:8000`.

## 1. Boot and initialize the stack

Run the following commands from the repository root:

```bash
# 1. Create your local environment file
cp .env.example .env

# 2. Build and start API, PostgreSQL 18, and Redis 7 in the background
docker compose up --build -d

# 3. Apply the Drizzle SQL migration
docker compose exec api npm run db:migrate

# 4. Seed deterministic demo data
docker compose exec api npm run db:seed
```

When `npm run db:seed` finishes, it prints a JSON summary of the records committed in its single transaction (`src/scripts/seed/index.ts`):

{% code title="Expected output from npm run db:seed" overflow="wrap" %}

```json
{
  "tables": {
    "users": 10,
    "contentItems": 100,
    "posts": 60,
    "articles": 40,
    "postMedia": 90,
    "follows": 30,
    "contentMentions": 80,
    "comments": 240,
    "contentReactions": 240,
    "commentReactions": 240,
    "contentSaves": 160,
    "contentShares": 80,
    "notifications": 610,
    "notificationDeliveries": 610,
    "interactionEvents": 510
  }
}
```

{% endcode %}

## 2. Verify server health

Query the `/health` endpoint registered in `src/app.ts`:

```bash
curl -s http://localhost:8000/health
```

```json
{
  "status": "OK",
  "timestamp": "2026-11-17T06:45:00.000Z",
  "uptime": 42.105
}
```

## 3. Query a public endpoint

Check username availability via `GET /api/v1/users/check-username` (`src/modules/users/user.routes.ts`). Because `alexmorgan` was created by the seed script (`src/scripts/seed/seed-data.ts`), the service returns `available: false` along with three unused username suggestions:

```bash
curl -s "http://localhost:8000/api/v1/users/check-username?username=alexmorgan"
```

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Username availability checked",
  "data": {
    "available": false,
    "suggestions": ["alexmorgan412", "alexmorgan883", "alexmorgan195"]
  },
  "timestamp": "2026-11-17T06:45:10.000Z"
}
```

## 4. Log in with a seeded demo account and fetch the feed

Every seeded demo account in `src/scripts/seed/seed-data.ts` uses the email pattern `<username>@writespace.test` (for example, `alexmorgan@writespace.test`, `mayachen@writespace.test`) and shares the password `WritespaceDemo2026!` (`DEMO_PASSWORD`). The first seeded user (`alexmorgan@writespace.test`) is assigned the admin role; all other nine demo users have the user role (`src/scripts/seed/users.seed.ts`).

**Obtain an access token** — call `POST /api/v1/auth/login` (`src/modules/auth/auth.routes.ts`):

```bash
curl -s -i -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alexmorgan@writespace.test",
    "password": "WritespaceDemo2026!"
  }'
```

The response sets an `HttpOnly` `refreshToken` cookie (for web clients) and returns a short-lived `accessToken` JWT in the JSON body (`src/modules/auth/auth.controller.ts`).

**Fetch the published Posts or Articles feed** — pass the `accessToken` in the `Authorization: Bearer <token>` header to `GET /api/v1/posts` (`src/modules/posts/posts.routes.ts`) or `GET /api/v1/articles` (`src/modules/articles/articles.routes.ts`):

```bash
curl -s "http://localhost:8000/api/v1/posts?limit=2" \
  -H "Authorization: Bearer <YOUR_ACCESS_TOKEN>"
```

## Key decisions & rationale

- **Deterministic UUID v5 seeding:** `seedUuid(key)` in `src/scripts/seed/seed-data.ts` hashes keys against a fixed namespace (`9c7a6e2f6e8b4c0b8f6e2a4d9c1b7a30`) using SHA-1 and RFC 4122 version 5 bits. Every developer who runs `npm run db:seed` gets the exact same user IDs, Post IDs, and Article slugs.
- **Empty-database guard on seeding:** `src/scripts/seed/index.ts` checks `SELECT id FROM users LIMIT 1` inside a transaction and aborts if any user row exists, preventing accidental duplication of demo data.

## Gotchas & edge cases

- **Enabling live notifications after seeding:** By default, `OUTBOX_PROCESSING_ENABLED` is `"false"` in `src/config/env.ts`. To test real-time Socket.IO notifications and background outbox processing when creating new comments, reactions, or follows, set `OUTBOX_PROCESSING_ENABLED=true` in `.env` and restart the `api` container (`docker compose restart api`).

- **Feed endpoints require authentication:** Both `GET /api/v1/posts` and `GET /api/v1/articles` apply the `authenticate` middleware (`src/modules/posts/posts.routes.ts`, `src/modules/articles/articles.routes.ts`). Only the social crawler preview routes (`GET /api/v1/posts/public/:id/preview` and `GET /api/v1/articles/public/:slug/preview`) and `GET /api/v1/users/check-username` are unauthenticated.

## Related

- [Installation & Local Setup](installation.md)
- [Configuration & Environment Profiles](configuration.md)
- [Project Tour](project-tour.md)
- [Deterministic Seeding & Fixtures](../data/seed-and-fixtures.md)

---

_Last verified against: v1.0.0 (12bc4d7, documentation branch, 2026-11-17)_
