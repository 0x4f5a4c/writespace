---
description: Required runtime versions, database engines, container tooling, and external service credentials needed to run Writespace locally.
---

# Prerequisites

> **Purpose:** List every software dependency and external credential required before installing and booting the Writespace backend.
> **Audience:** Internal developers setting up a development machine.
> **Prerequisites:** Familiarity with Git, terminal commands, PostgreSQL, and Node.js or Docker.

## Overview

Writespace supports two local development workflows: **Docker Compose** (which runs the API, PostgreSQL 18, and Redis 7 in containers) and **Native Node.js** (which runs the TypeScript server directly on your host machine against local PostgreSQL and Redis instances). Regardless of which workflow you choose, the application validates its environment variables at startup in `src/config/env.ts` and requires valid connection strings and secret formats before the server will listen for requests.

## Runtime & infrastructure requirements

{% tabs %}
{% tab title="Docker Compose Workflow (Recommended)" %}
When running via `docker-compose.yml`, you do not need Node.js, PostgreSQL, or Redis installed on your host machine.

| Requirement                 | Version                | Evidence / Source                    | Notes                                                                                                       |
| :-------------------------- | :--------------------- | :----------------------------------- | :---------------------------------------------------------------------------------------------------------- |
| **Docker Engine / Desktop** | Latest stable          | `README.md`, `Dockerfile`            | Must support multi-stage `Dockerfile` builds on `node:24-bookworm-slim`.                                    |
| **Docker Compose**          | V2 (`docker compose`)  | `README.md`, `docker-compose.yml`    | Uses `condition: service_healthy` healthcheck dependencies.                                                 |
| **Git**                     | Any recent             | `README.md`                          | Required to clone the repository.                                                                           |
| **Available Host Ports**    | `8000`, `5433`, `6380` | `docker-compose.yml`, `.env.example` | Bound to `127.0.0.1` by default; configurable via `HOST_PORT`, `POSTGRES_HOST_PORT`, and `REDIS_HOST_PORT`. |

{% endtab %}

{% tab title="Native Node.js Workflow" %}
When running directly on your host machine (`npm run dev`), install the following runtimes and data stores:

| Requirement            | Version                      | Evidence / Source                              | Notes                                                                                                     |
| :--------------------- | :--------------------------- | :--------------------------------------------- | :-------------------------------------------------------------------------------------------------------- |
| **Node.js**            | `24+` (minimum `>=22.12.0`)  | `Dockerfile`, `README.md`, `package-lock.json` | `Dockerfile` uses `node:24-bookworm-slim`; `sanitize-html@2.18.1` requires Node `>=22.12.0`.              |
| **npm**                | `10+` (bundled with Node 24) | `README.md`, `package.json`                    | Used for dependency installation and script execution.                                                    |
| **PostgreSQL**         | `18` (or `15+`)              | `docker-compose.yml`, `README.md`              | `docker-compose.yml` runs `postgres:18-alpine`; `README.md` permits `15+`.                                |
| **Redis**              | `7+`                         | `docker-compose.yml`, `README.md`              | Must support `GETDEL` (Redis 6.2+) used in `src/modules/auth/oauth-state.store.ts` and `auth.service.ts`. |
| **POSIX Shell (`sh`)** | Standard `sh`                | `package.json`                                 | Required by `"db:seed": "sh scripts/seed.sh"`.                                                            |

{% endtab %}
{% endtabs %}

## Required external credentials & secrets

At startup, `src/config/env.ts` parses `process.env` against `envSchema` using Zod. The process exits with code `1` if any required variable is missing or malformed.

| Service / Category          | Required Variables                                                                     | Local Development Requirement                                                                                                                                                                                                                         |
| :-------------------------- | :------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **JWT & Challenge Secrets** | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `AUTH_CHALLENGE_SECRET`                     | `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` must be non-empty strings. `AUTH_CHALLENGE_SECRET` **must** be a 64-character hexadecimal string (`/^[a-fA-F0-9]{64}$/`).                                                                                |
| **Cloudinary**              | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`                 | Non-empty strings required at boot (`src/config/env.ts`). Real credentials are required only when uploading Post media, Article cover images, or profile/banner images (`src/shared/middlewares/upload.middleware.ts`).                               |
| **SMTP (Nodemailer)**       | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`                                     | `SMTP_USER` and `SMTP_PASS` must be non-empty at boot (`src/config/env.ts`). Real SMTP credentials (or a local SMTP sink such as Mailpit/Mailtrap) are required to receive registration OTP and password reset emails (`src/shared/infra/mailer.ts`). |
| **Google & GitHub OAuth**   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | **Optional** in `src/config/env.ts`. Strategies in `src/modules/auth/auth.utils.ts` are registered only when the respective ID and secret are provided.                                                                                               |
| **AI Configuration**        | `AI_MODEL`, `GEMINI_API_KEY`                                                           | Must be non-empty strings in `.env` to pass `src/config/env.ts` validation even when `AI_ENABLED=false` (the default values in `.env.example` — `AI_MODEL=ai_model` and `GEMINI_API_KEY=ai_key` — satisfy boot validation).                           |

{% hint style="info" %}
**Generating `AUTH_CHALLENGE_SECRET`:** The example value in `.env.example` (`0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef`) satisfies the 64-hex-character regex for local development. To generate a unique secret, run `openssl rand -hex 32`.
{% endhint %}

## Key decisions & rationale

- **PostgreSQL 18 in Docker with isolated volume:** `docker-compose.yml` uses `postgres:18-alpine` and mounts the named volume `postgres_data_v18:/var/lib/postgresql` so PostgreSQL 18 data files never collide with older PostgreSQL 15 volume layouts (`docker-compose.yml`).
- **Strict boot-time environment validation:** Rather than failing mid-request when a secret or timeout is missing, `src/config/env.ts` validates and coerces all environment variables synchronously when imported.

## Gotchas & edge cases

- **Host port remapping in Docker Compose:** To avoid conflicting with a host-installed PostgreSQL (`5432`) or Redis (`6379`) service, `docker-compose.yml` maps PostgreSQL to host port `5433` (`127.0.0.1:5433:5432`) and Redis to host port `6380` (`127.0.0.1:6380:6379`). Inside the Docker network, the `api` container connects to `postgres:5432` and `redis:6379` automatically.

- **Redis `GETDEL` command requirement:** Both `RedisOAuthStateStore.consumeState` (`src/modules/auth/oauth-state.store.ts`) and `AuthService.verifyRegistration` (`src/modules/auth/auth.service.ts`) call `redis.getDel(key)` to consume one-time challenges atomically. Ensure any native Redis installation is version 6.2 or newer (Redis 7+ recommended).

- **Outbound network access for profile OG images:** `generateProfileOgImage` in `src/shared/utils/og-generator.ts` fetches `Inter-SemiBold.otf` from `https://cdn.jsdelivr.net/gh/rsms/inter@3.19/docs/font-files/Inter-SemiBold.otf` on its first invocation and caches the `ArrayBuffer` in memory.

## Related

- [Installation & Local Setup](installation.md)
- [5-Minute Quickstart](quickstart.md)
- [Configuration & Environment Profiles](configuration.md)
- [Environment Variables](../reference/env-vars.md)

---

_Last verified against: v1.0.0 (12bc4d7, documentation branch, 2026-11-17)_
