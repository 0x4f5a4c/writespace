# WriteSpace API

> Production-grade blogging platform backend — RESTful API with role-based auth, social interactions, and async notifications.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org/)
[![Express](https://img.shields.io/badge/Express-5.0-black)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1)](https://www.postgresql.org/)
[![CI](https://github.com/Afzal14786/writespace/actions/workflows/ci.yml/badge.svg)](https://github.com/Afzal14786/writespace/actions/workflows/ci.yml)
[![Build](https://github.com/Afzal14786/writespace/actions/workflows/build.yml/badge.svg)](https://github.com/Afzal14786/writespace/actions/workflows/build.yml)
[![Redis](https://img.shields.io/badge/Redis-7.2-DC382D)](https://redis.io/)
[![Drizzle](https://img.shields.io/badge/Drizzle-ORM-green)](https://orm.drizzle.team/)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

## 📖 Table of Contents
- [🚀 Features](#-features)
- [🏗️ Architecture Overview](#️-architecture-overview)
- [⚡ Quick Start](#-quick-start)
- [📁 Project Structure](#-project-structure)
- [🔗 API Endpoints](#-api-endpoints)
- [🧪 Testing](#-testing)
- [📦 Deployment](#-deployment)
- [🤝 Contributing](#-contributing)
- [📄 License](#-license)

## 🚀 Features
| Category | Features |
|----------|----------|
| **Authentication** | JWT with refresh rotation, OAuth2 (Google/GitHub), password reset, role-based access (user/admin) |
| **Content Management** | Rich text posts, drafts, scheduled publishing, post sharing |
| **Social Interactions** | Likes, comments (threaded replies), shares, user profiles with shareable links |
| **Notifications** | Email + in-app notifications via BullMQ queues, async processing |
| **Media Handling** | Cloudinary uploads with custom Multer storage engine, automatic image optimization, multipart form-data support |
| **API Design** | RESTful, cursor/offset pagination, rate-limited (100 req/15min), consistent error responses |

## 🏗️ Architecture Overview

```mermaid
graph TD
    Client[Client Application] -->|HTTP| API[Express Server]
    API --> Auth[Auth Middleware]
    Auth --> Rate[Rate Limiter]
    Rate --> Controller[Module Controller]
    Controller --> Service[Module Service]
    Service --> DB[(PostgreSQL)]
    Service --> Cache[(Redis Cache)]
    Service --> Queue[BullMQ Queue]
    Queue --> Email[Email Worker]
    Queue --> Notif[Notification Worker]
    Email --> SMTP[Nodemailer]
    Service --> Cloudinary[Cloudinary CDN]
    Queue --> Media[Media Cleanup Worker]
    Media --> Cloudinary
```

## Key Architectural Decisions:

-  **Vertical Slicing:** Each feature (`auth`, `posts`, `users`) contains all layers (controller, service, routes) for high cohesion

-  **Dependency Inversion:** Shared infrastructure lives in `shared/`; modules don't import each other directly
-  **Async Notifications:** Email and in-app notifications are queued via BullMQ to prevent blocking API responses
-  **Dual Token Auth:** Access token (15m lifetime) + refresh token (7d, stored in Redis) for security
- **External Media Storage:** All uploads stream directly to Cloudinary via a custom Multer storage engine; `public_id`s are persisted alongside URLs so assets can be cleaned up when posts or accounts are deleted

## ⚡ Quick Start

### Prerequisites

-  **Node.js** v24+
-  **npm** v10+
-  **PostgreSQL** 16+ (or use Docker)
-  **Redis** 7.2+ (or use Docker) 

### Installation

```bash
# Clone the repository
git clone https://github.com/Afzal14786/writespace.git
cd writespace

# Install dependencies
npm ci

# Copy environment template
cp .env.example .env
# Then edit .env with your local values
# See DEVELOPER.md for full setup instructions

# Generate and run database migrations
npm run db:generate
npm run db:migrate

# Start development server
npm run dev
```   

> **Note:** PostgreSQL and Redis must be running locally. See **[DEVELOPER.md](./DEVELOPER.md)** for setup instructions.  

### Environment Variables (.env) 

```env
PORT=8000
NODE_ENV=development
DATABASE_URL=postgresql://postgres:password@localhost:5432/writespace
REDIS_URL=redis://localhost:6379

JWT_ACCESS_SECRET=your-access-secret-key-minimum-32-characters
JWT_REFRESH_SECRET=your-refresh-secret-key-minimum-32-characters
JWT_ACCESS_EXPIRE=15m
JWT_REFRESH_EXPIRE=7d

CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-cloudinary-api-key
CLOUDINARY_API_SECRET=your-cloudinary-api-secret

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-specific-password

CLIENT_URL=http://localhost:5173
```  

> See [.env.example](.env.example) for the full list of configuration options.  

## 📁 Project Structure

```text
writespace/
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                  # Lint, typecheck, build, test on every PR
│   │   ├── build.yml               # Production build verification on push
│   │   └── deploy.yml              # Triggers Render deploy after CI passes
│   └── dependabot.yml              # Weekly dependency update PRs
│
├── drizzle/                        # SQL migrations (auto-generated by drizzle-kit)
│   ├── 0000_…0007_*.sql            # Sequential migration files
│   └── meta/                       # Drizzle journal + snapshots (gitignored)
│
├── src/
│   ├── config/
│   │   ├── env.ts                  # Zod-validated environment variables
│   │   ├── logger.ts               # Zario structured logger
│   │   └── redis.ts                # Redis client + BullMQ connection
│   │
│   ├── db/
│   │   ├── index.ts                # PostgreSQL pool + Drizzle instance
│   │   └── schema/                 # Drizzle table definitions
│   │       ├── users.ts            # Users table (auth, profile, social links)
│   │       ├── posts.ts            # Posts table (content, media, cover)
│   │       ├── comments.ts         # Threaded comments
│   │       ├── comment-likes.ts    # Composite-key likes on comments
│   │       ├── likes.ts            # Likes on posts
│   │       ├── shares.ts           # Share tracking per platform
│   │       ├── follows.ts          # Follower/following relationships
│   │       ├── notifications.ts    # In-app notifications
│   │       ├── relations.ts        # Drizzle relations for joins
│   │       └── index.ts            # Barrel export
│   │
│   ├── modules/                    # Feature slices — one folder per domain
│   │   ├── auth/                   # Register, login, OAuth, password reset
│   │   │   ├── dtos/               # Zod request schemas
│   │   │   ├── interface/          # TypeScript interfaces (JWT, OAuth)
│   │   │   ├── auth.controller.ts
│   │   │   ├── auth.service.ts     # Business logic
│   │   │   ├── auth.routes.ts
│   │   │   └── auth.utils.ts       # Passport strategies, OTP generator
│   │   │
│   │   ├── users/                  # User CRUD, profiles, follow system
│   │   │   ├── dtos/
│   │   │   ├── interface/
│   │   │   ├── user.controller.ts
│   │   │   ├── user.service.ts
│   │   │   └── user.routes.ts
│   │   │
│   │   ├── posts/                  # Post CRUD, feed, cover images, media
│   │   │   ├── dtos/
│   │   │   ├── interfaces/
│   │   │   ├── posts.controller.ts
│   │   │   ├── posts.service.ts
│   │   │   └── posts.routes.ts
│   │   │
│   │   ├── interactions/           # Comments, likes, shares on posts/comments
│   │   │   ├── dtos/
│   │   │   ├── interface/
│   │   │   ├── interactions.controllers.ts
│   │   │   ├── interactions.service.ts
│   │   │   └── interactions.routes.ts
│   │   │
│   │   └── notification/           # Email + in-app notifications
│   │       ├── interface/
│   │       ├── templates/          # HTML email templates (welcome, OTP, reset)
│   │       ├── notification.controller.ts
│   │       ├── notification.service.ts
│   │       └── notification.routes.ts
│   │
│   ├── shared/                     # Cross-cutting concerns
│   │   ├── constants/
│   │   │   └── http-codes.ts       # HTTP_STATUS enum
│   │   │
│   │   ├── infra/
│   │   │   └── mailer.ts           # Nodemailer SMTP transport wrapper
│   │   │
│   │   ├── middlewares/
│   │   │   ├── auth.middleware.ts          # authenticate() + authorize()
│   │   │   ├── upload.middleware.ts        # Custom Cloudinary Multer storage engine
│   │   │   ├── validate.middleware.ts      # Zod schema validation
│   │   │   ├── error.middleware.ts         # Global error handler
│   │   │   ├── rate-limit.middleware.ts    # express-rate-limit + Redis store
│   │   │   ├── parse-form-data.middleware.ts  # Multipart JSON parsing
│   │   │   ├── bot-interceptor.middleware.ts  # Bot detection for OG images
│   │   │   └── httpLogger.ts               # Morgan HTTP request logger
│   │   │
│   │   ├── queues/                 # BullMQ queues and workers
│   │   │   ├── email.queue.ts
│   │   │   ├── email.worker.ts
│   │   │   ├── interaction.queue.ts
│   │   │   ├── interaction.worker.ts
│   │   │   ├── media.queue.ts      # Enqueues Cloudinary cleanup jobs
│   │   │   └── media.worker.ts     # Deletes assets via cloudinary.uploader.destroy
│   │   │
│   │   ├── types/
│   │   │   ├── cloudinary-file.ts  # CloudinaryFile, CloudinaryFilesMap
│   │   │   └── express.d.ts        # req.user augmentation
│   │   │
│   │   └── utils/
│   │       ├── api-response.ts     # Standard ApiResponse wrapper
│   │       ├── app.error.ts        # Custom AppError class
│   │       └── og-generator.ts     # Satori-based dynamic OG image renderer
│   │
│   ├── app.ts                      # Express app setup + middleware chain
│   └── server.ts                   # Entry point, worker boot, graceful shutdown
│
├── test/
│   ├── __mocks__/
│   │   └── sanitize-html.ts        # Jest mock (bypasses ESM htmlparser2@10)
│   ├── integration/
│   │   └── health.test.ts          # App-level routing test
│   └── unit/
│       └── modules/                # One folder per module, mirrors src/modules
│
├── .env.example                    # Environment variable template
├── .gitignore
├── drizzle.config.ts               # Drizzle Kit configuration
├── eslint.config.mjs               # ESLint flat config
├── jest.config.ts                  # Jest + ts-jest configuration
├── nodemon.json                    # Dev server watch config
├── package.json
├── package-lock.json
├── README.md
├── tsconfig.json
├── tsconfig.eslint.json
└── typedoc.json                    # API docs generation config
```

### Key directories

| Path | Purpose |
|---|---|
| `src/config/` | Runtime configuration — Zod-validated env, structured logging, Redis client |
| `src/db/` | Drizzle ORM setup and table schemas |
| `src/modules/` | Vertical slices. Each module owns its controller, service, routes, DTOs, and interfaces |
| `src/shared/` | Reusable infrastructure — middleware, BullMQ queues/workers, utilities, external clients |
| `test/` | Unit tests (mocked dependencies) and integration tests (supertest) |
| `drizzle/` | Auto-generated SQL migrations. Never edit by hand; regenerate with `npm run db:generate` |
| `.github/workflows/` | CI, build verification, and Render deploy hook |  

---  

## 🌐 API Endpoints

### 🔐 Authentication (`/api/v1/auth`)

| Method | Endpoint | Description | Auth Requirement |
| :--- | :--- | :--- | :--- |
| `POST` | `/register` | Register a new user (Rate limited) | Public |
| `POST` | `/verify-email` | Verify OTP and create account | Public |
| `POST` | `/login` | Log in and receive tokens | Public |
| `POST` | `/forgot-password` | Request password reset | Bearer |
| `POST` | `/reset-password` | Reset password via token | Public |
| `PUT` | `/update-password` | Update logged-in user's password | Bearer |
| `POST` | `/refresh-token` | Get new access token | Refresh Token |
| `POST` | `/logout` | Log out and invalidate session | Public |
| `GET` | `/google` | Initiate Google OAuth | Public |
| `GET` | `/google/callback` | Google OAuth Callback | Public |
| `GET` | `/github` | Initiate GitHub OAuth | Public |
| `GET` | `/github/callback` | GitHub OAuth Callback | Public |

### 💬 Interactions (`/api/v1/interactions`)

| Method | Endpoint | Description | Auth Requirement |
| :--- | :--- | :--- | :--- |
| `GET` | `/comments/:postId` | Get top-level comments for a post | Bearer |
| `POST` | `/comments/:postId` | Add a comment to a post | Bearer |
| `GET` | `/comments/:commentId/replies` | Fetch replies for a specific comment | Bearer |
| `POST` | `/comments/:commentId/like` | Toggle Like/Unlike on a comment | Bearer |
| `POST` | `/posts/:postId/like` | Toggle Like/Unlike on a post | Bearer |
| `PUT` | `/comments/:commentId` | Update an existing comment | Bearer |
| `DELETE` | `/comments/:commentId` | Delete a comment | Bearer |

### 🔔 Notifications (`/api/v1/notifications`)

| Method | Endpoint | Description | Auth Requirement |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | Get all user notifications | Bearer |
| `PUT` | `/read` | Mark specific notification as read | Bearer |
| `PUT` | `/read-all` | Mark all notifications as read | Bearer |

### 📝 Posts (`/api/v1/posts`)

| Method | Endpoint | Description | Auth Requirement |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | Get all posts (Paginated) | Bearer |
| `GET` | `/:id` | Get single post details | Bearer |
| `POST` | `/` | Create a new post (Supports Multipart/form-data) | Bearer |
| `PUT` | `/:id` | Update an existing post (Supports Multipart) | Bearer |
| `DELETE` | `/:id` | Delete a post | Bearer |
| `POST` | `/:id/like` | Like a post | Bearer |
| `POST` | `/:id/share` | Generate share link for a post | Public |

### 👥 Users (`/api/v1/users`)

| Method | Endpoint | Description | Auth Requirement |
| :--- | :--- | :--- | :--- |
| `GET` | `/check-username` | Check if a username is available | Public |
| `GET` | `/og/:username` | Get profile dynamic OpenGraph image | Public |
| `GET` | `/search` | Search users by username or fullname | Bearer |
| `GET` | `/me` | Get current authenticated user's session data | Bearer |
| `GET` | `/profile/:username` | Get public profile data (Follow stats attached if logged in) | Optional |
| `POST` | `/:id/follow` | Toggle follow/unfollow for a user | Bearer |
| `PUT` | `/:id` | Update profile fields & images (Multipart/form-data) | Owner / Admin |
| `DELETE` | `/:id` | Suspend or soft-delete account | Owner / Admin |  

*Full API documentation available at [docs.writespace.com](docs.writespace.com) (coming soon)*  

## 🧪 Testing

The project uses **Jest** with **ts-jest** for unit and integration tests. All tests run against mocked external dependencies (PostgreSQL, Redis, Cloudinary, Nodemailer), so no services need to be running locally.

### Commands

```bash
# Run the full suite once (used by CI)
npm test

# Watch mode — re-runs related tests on file change
npm run test:watch

# With coverage report
npm run test:cov
```  

### Interactive coverage report  

`npm run test:cov` generates an HTML report at:  

```text
coverage/lcov-report/index.html
```  

Open it in a browser to see line-by-line coverage, per-file breakdowns, and uncovered branches:  

```bash
# macOS
open coverage/lcov-report/index.html

# Linux
xdg-open coverage/lcov-report/index.html

# Windows (PowerShell)
start coverage/lcov-report/index.html
```  

> **Note:** `coverage/` is gitignored — it's a local build artifact, regenerate it any time with `npm run test:cov`.  

### Current coverage  

**Test suites:** 11 passing · **Tests:** 50 passing  

| Scope | Statements | Branches | Functions | Lines |
|-------|------------|----------|-----------|-------|
| Overall | 49.41% | 23.60% | 35.29% | 49.69% |
| `src/config` | 87.50% | 33.33% | 100% | 87.50% |
| `src/db/schema` | 79.54% | 100% | 43.75% | 77.77% |
| `src/modules/auth` | 38.21% | 22.00% | 22.22% | 37.86% |
| `src/modules/posts` | 39.50% | 17.07% | 22.22% | 40.44% |
| `src/modules/users` | 29.35% | 7.93% | 13.63% | 31.47% |
| `src/modules/interactions` | 48.95% | 24.67% | 37.03% | 49.47% |
| `src/modules/notification` | 52.63% | 25.00% | 55.00% | 55.05% |
| `src/shared/middlewares` | 52.51% | 35.05% | 41.37% | 51.70% |

Coverage is tracked per PR; the CI workflow fails if any test suite fails.  

---  

## 📦 Deployment

The API is deployed on **Render** (free tier) with **Neon** for PostgreSQL and **Upstash** for Redis.

**Live API:** `https://writespace-api.onrender.com` *(replace with your actual URL after deployment)*

**Health check:** [`GET /health`](https://writespace-api.onrender.com/health)

### Deployment architecture

| Layer | Provider | Free tier |
|---|---|---|
| Web service | Render | 750 hrs/mo, spins down after 15 min idle |
| PostgreSQL | Neon | 0.5 GB storage, permanent |
| Redis | Upstash | 256 MB, 500K commands/mo, permanent |

### CI/CD

- **On pull request:** [`ci.yml`](./.github/workflows/ci.yml) runs lint → typecheck → build → test
- **On push to `main`:** [`build.yml`](./.github/workflows/build.yml) verifies the production build
- **After CI passes on `main`:** [`deploy.yml`](./.github/workflows/deploy.yml) triggers a Render deploy via webhook

See [DEPLOYMENT.md](./DEPLOYMENT.md) for full setup and troubleshooting.  

### Environment Requirements
-  Node.js 18+ or Bun
-  PostgreSQL 16+ (managed RDS recommended)
-  Redis 7.2+ (ElastiCache or Upstash)
-  AWS S3 bucket for media storage

### 🤝 Contributing
We welcome contributions! Please read:  

-  [Contributing Guide](./CONTRIBUTING.md) — Code of conduct, PR process
-  [Developer Guide](./DEVELOPER.md) — Deep architecture, adding features
-  [Code Of Conduct](./CODE_OF_CONDUCT.md)  

### 📄 License
MIT © WriteSpace — see [LICENSE](./LICENSE) for details.