---
description: Step-by-step instructions for installing Writespace dependencies, configuring local directories, and initializing PostgreSQL with Drizzle.
---

# Installation & Local Setup

> **Purpose:** Walk through cloning the repository, preparing `.env` and runtime directories, and initializing the PostgreSQL schema via Docker or native Node.js.
> **Audience:** Internal developers setting up a local development environment.
> **Prerequisites:** Complete the checks in [Prerequisites](prerequisites.md).

## Overview

You can run Writespace locally either inside Docker containers (`docker-compose.yml`) or directly on your host OS with Node.js (`npm run dev`). Both setups compile or execute the same TypeScript source tree under `src/`, connect to PostgreSQL and Redis, and use Drizzle Kit (`drizzle.config.ts`) to apply the database schema.

## Step-by-step installation

{% stepper %}

{% step %}

### Clone the repository and create `.env`

Clone the repository and copy `.env.example` to `.env`:

```bash
git clone https://github.com/Afzal14786/writespace.git
cd writespace
cp .env.example .env
```

By default, `.env.example` is pre-configured with host ports `5433` (PostgreSQL) and `6380` (Redis) matching the published ports of `docker-compose.yml`:

{% code title=".env.example (Database & Redis excerpt)" overflow="wrap" %}
DATABASE_URL=postgresql://writespace:writespace_dev_password@localhost:5433/writespace
DATABASE_DIRECT_URL=postgresql://writespace:writespace_dev_password@localhost:5433/writespace
REDIS_URL=redis://localhost:6380
{% endcode %}

If you are using Native Node.js against standard local ports (`5432` and `6379`), update `DATABASE_URL`, `DATABASE_DIRECT_URL`, and `REDIS_URL` in `.env` to match your local credentials and ports.
{% endstep %}

{% step %}

### Prepare runtime directories (`uploads/` and `logs/`)

The application writes rotating log files to `logs/combined.log` (`src/config/logger.ts`) and serves static files from `uploads/` (`src/app.ts`).

- **Docker workflow:** The `Dockerfile` runs `RUN mkdir -p logs uploads`, and `docker-compose.yml` bind-mounts `./logs:/app/logs` and `./uploads:/app/uploads`.
- **Native Node.js workflow:** Ensure both directories exist and are writable in your project root:

```bash
mkdir -p logs uploads
```

{% hint style="warning" %}
**Runtime directory hygiene:** The `uploads/` directory must exist and be writable for local development. In Docker it is created at image build time (`Dockerfile`) and bind-mounted by `docker-compose.yml`; in native Node.js, Zario's `FileTransport` (`src/config/logger.ts`) writes to `logs/combined.log` and Express serves `/uploads` via `app.use("/uploads", express.static("uploads"))` (`src/app.ts`). Do not commit the contents of `uploads/` or `logs/*` (except `logs/.gitkeep`) — both are ignored in `.gitignore`.
{% endhint %}
{% endstep %}

{% step %}

### Install dependencies or build containers

{% tabs %}
{% tab title="Docker Compose" %}
Build the development stage of `Dockerfile` and start the `api`, `postgres`, and `redis` containers:

```bash
docker compose up --build -d
```

Verify that all three services report healthy status (`writespace-api-dev`, `writespace-postgres-dev`, `writespace-redis-dev`):

```bash
docker compose ps
```

{% endtab %}

{% tab title="Native Node.js" %}
Install npm dependencies on your host machine:

```bash
npm install
```

Ensure your local PostgreSQL and Redis servers are running, and create an empty database named `writespace` if it does not already exist.
{% endtab %}
{% endtabs %}
{% endstep %}

{% step %}

### Initialize the PostgreSQL schema

Writespace provides two mutually exclusive ways to initialize your local database schema. Choose **Option A** (recommended, applies committed SQL migrations from `drizzle/0000_initial_schema.sql`) or **Option B** (pushes `src/db/schema/index.ts` directly to the database for rapid prototyping):

{% tabs %}
{% tab title="Docker Compose" %}

```bash
# Option A: Apply committed Drizzle migrations (Recommended)
docker compose exec api npm run db:migrate

# Option B: Push schema directly without migration history
docker compose exec api npm run db:push
```

{% endtab %}

{% tab title="Native Node.js" %}

```bash
# Option A: Apply committed Drizzle migrations (Recommended)
npm run db:migrate

# Option B: Push schema directly without migration history
npm run db:push
```

{% endtab %}
{% endtabs %}

{% hint style="danger" %}
**Do not mix `db:migrate` and `db:push` on the same database:** `npm run db:migrate` (`drizzle-kit migrate`) records applied migrations in `drizzle.__drizzle_migrations` (`drizzle.config.ts`) and creates the 8 enums and 28 tables defined in `drizzle/0000_initial_schema.sql`. Running `db:migrate` after `db:push` will fail with duplicate type/table errors (`42710` / `42P07`).
{% endhint %}
{% endstep %}

{% endstepper %}

## Hybrid development workflow (Host Node.js + Docker DB/Redis)

Because `docker-compose.yml` publishes PostgreSQL on `127.0.0.1:5433` and Redis on `127.0.0.1:6380` matching `.env.example`, you can also run only the data stores in Docker while running the Node.js API natively on your host:

```bash
# Start only PostgreSQL 18 and Redis 7 in Docker
docker compose up -d postgres redis

# Run migrations, seed, and start Nodemon on the host using .env defaults
npm run db:migrate
npm run db:seed
npm run dev
```

## Key decisions & rationale

- **Dedicated `DATABASE_DIRECT_URL` for Drizzle Kit:** `drizzle.config.ts` explicitly requires `DATABASE_DIRECT_URL` and throws an `AppError(500, "DATABASE_DIRECT_URL must be configured for Drizzle Kit operations.")` if unset, preventing schema migrations from accidentally running through a transaction-pooled connection (see [ADR-0006](../decisions/ADR-0006-direct-connection-migrations.md)).
- **Separate `drizzle` migration schema:** `drizzle.config.ts` stores migration tracking in `drizzle.__drizzle_migrations` rather than `public`, keeping operational migration metadata isolated from application tables.

## Gotchas & edge cases

- **Docker Compose overrides `.env` connection strings:** Inside `docker-compose.yml`, the `api` service's `environment:` block explicitly sets `DATABASE_URL`, `DATABASE_DIRECT_URL` (`@postgres:5432`), `REDIS_URL` (`redis://redis:6379`), `REDIS_PASSWORD: ""`, and `TRUST_PROXY_HOPS: "0"`, overriding whatever values are in your local `.env` file when running inside the container.

- **Dependency changes require image rebuilds in Docker:** `docker-compose.yml` bind-mounts `./src:/app/src` for live Nodemon reloading, but `node_modules` lives inside the container image. If you modify `package.json`, run `docker compose up --build` to rebuild the container.

## Related

- [Prerequisites](prerequisites.md)
- [5-Minute Quickstart](quickstart.md)
- [Migrations & Drizzle Kit](../data/migrations.md)
- [Deterministic Seeding & Fixtures](../data/seed-and-fixtures.md)

---

_Last verified against: v1.0.0 (12bc4d7, documentation branch, 2026-11-17)_
