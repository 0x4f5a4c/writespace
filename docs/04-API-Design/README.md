# WriteSpace API Overview

## 1. Introduction

The WriteSpace API is a RESTful backend API that provides the core functionality required by the WriteSpace platform.

The API is responsible for handling:

- User authentication and authorization
- User profile management
- Blog post creation and management
- Comments and threaded replies
- Reactions
- Post saves
- Post sharing
- User following
- Notifications
- Media handling
- Asynchronous and event-driven processing

The API is implemented using Node.js, TypeScript, Express.js, PostgreSQL, Redis, and supporting infrastructure.

---

## 2. API Base URL

### Development

```text
http://localhost:8000/api/v1
```

### Production

The production base URL should be documented once the deployment environment is finalized.

```text
https://<production-domain>/api/v1
```

All API endpoints are exposed below the `/api/v1` version prefix.

---

## 3. API Versioning

WriteSpace currently uses URL-based API versioning.

```text
/api/v1
```

For example:

```http
GET /api/v1/posts
```

### Why API Versioning Is Used

API versioning allows future changes to the API contract without immediately breaking existing clients.

For example:

```text
/api/v1/posts
/api/v2/posts
```

can coexist if a future version introduces breaking changes.

---

## 4. API Architecture

The API follows a modular architecture.

At a high level:

```text
Client
  │
  ▼
HTTP Request
  │
  ▼
Express Router
  │
  ▼
Middleware
  │
  ├── Authentication
  ├── Authorization
  ├── Validation
  ├── Rate Limiting
  └── Other Cross-Cutting Concerns
  │
  ▼
Controller
  │
  ▼
Service
  │
  ├── Domain Logic
  ├── Repository / Data Access
  ├── Redis
  ├── Event Publishing
  └── External Services
  │
  ▼
Database / Redis / Queue / External Service
```

The controller is responsible for handling HTTP concerns, while the service layer contains application and business logic.

---

# 5. API Module Organization

The WriteSpace API is organized around business modules.

```text
/api/v1
│
├── /auth
├── /users
├── /posts
├── /interactions
└── /notifications
```

The exact routes may evolve as the application grows.

---

# 6. API Module Responsibilities

## 6.1 Authentication API

Base path:

```text
/api/v1/auth
```

Responsible for:

- User registration
- Email verification
- Login
- JWT access tokens
- Refresh tokens
- Logout
- Password reset
- Password update
- Google OAuth
- GitHub OAuth

Detailed documentation:

```text
04-API-Design/02-Authentication-APIs.md
```

---

## 6.2 Users API

Base path:

```text
/api/v1/users
```

Responsible for functionality related to users and profiles.

Examples include:

- User profile retrieval
- Profile updates
- User search
- Following-related operations
- Other user-management operations

Detailed API documentation:

```text
04-API-Design/03-User-APIs.md
```

---

## 6.3 Posts API

Base path:

```text
/api/v1/posts
```

Responsible for:

- Creating posts
- Updating posts
- Deleting posts
- Publishing posts
- Drafts
- Scheduled publishing
- Post retrieval
- Pagination
- Media handling
- Post sharing integration

The Post module owns the lifecycle and content of posts.

Detailed API documentation:

```text
04-API-Design/04-Post-APIs.md
```

---

## 6.4 Interactions API

Base path:

```text
/api/v1/interactions
```

Responsible for user interactions with content and users.

Examples include:

- Reactions
- Comments
- Replies
- Saves
- Shares
- Follow/unfollow operations

The Interaction module owns interaction persistence and interaction-related events.

Detailed API documentation:

```text
04-API-Design/05-Interaction-APIs.md
```

---

## 6.5 Notifications API

Base path:

```text
/api/v1/notifications
```

Responsible for retrieving and managing user notifications.

Examples include:

- Listing notifications
- Reading notifications
- Marking notifications as read
- Notification-related operations

Detailed API documentation:

```text
04-API-Design/06-Notification-APIs.md
```

---

# 7. HTTP Methods

WriteSpace follows standard HTTP methods according to the operation being performed.

| Method | Purpose                                | Example                     |
| ------ | -------------------------------------- | --------------------------- |
| GET    | Retrieve resources                     | `GET /posts/:id`            |
| POST   | Create a resource or trigger an action | `POST /posts`               |
| PUT    | Replace/update a resource              | `PUT /auth/update-password` |
| PATCH  | Partially update a resource            | `PATCH /users/profile`      |
| DELETE | Remove a resource                      | `DELETE /posts/:id`         |

The exact method should be documented for every endpoint in its module-specific API documentation.

---

# 8. Request Structure

Depending on the endpoint, requests can contain:

- Path parameters
- Query parameters
- Request headers
- Request body
- Authentication credentials
- Cookies

Example:

```http
POST /api/v1/auth/login
Content-Type: application/json
```

```json
{
  "email": "user@example.com",
  "password": "Password123"
}
```

---

# 9. Authentication

Protected APIs use token-based authentication.

The authentication architecture uses:

- JWT access tokens
- Refresh tokens
- HTTP-only refresh-token cookies
- Redis-backed refresh-token storage

A typical authenticated request contains:

```http
Authorization: Bearer <access-token>
```

The exact authentication requirements are documented at the endpoint level.

---

# 10. Authorization

Authentication answers:

> Who is the user?

Authorization answers:

> Is this user allowed to perform this operation?

WriteSpace uses authenticated user information such as:

```text
user ID
role
account status
```

to determine whether an operation can be performed.

Authorization rules are documented in the relevant API and feature-module documentation.

---

# 11. Validation

Request validation is performed before the request reaches the main business logic.

WriteSpace uses schema-based validation.

The validation layer is responsible for checking:

- Required fields
- Field types
- String lengths
- Email formats
- Password requirements
- Enum values
- Other endpoint-specific constraints

Example registration requirements:

```text
fullname  → minimum 3 characters
username  → minimum 3 characters
email     → valid email
password  → minimum 8 characters
             uppercase required
             lowercase required
             number required
```

Invalid requests should be rejected before executing the main service logic.

---

# 12. Rate Limiting

Rate limiting is applied to sensitive endpoints to reduce abuse.

Examples include:

- Registration
- Login
- Email verification
- Password reset
- Other email-related actions

Rate limiting configuration is part of the API's security layer.

Detailed behavior should be documented in:

```text
07-Cross-Cutting-Concerns/04-Rate-Limiting.md
```

---

# 13. Response Structure

API responses generally contain:

- HTTP status code
- Response body
- Success or error information
- Resource data when applicable

A successful response may look like:

```json
{
  "success": true,
  "message": "Operation completed successfully",
  "data": {}
}
```

The exact response structure depends on the implementation of the endpoint and should be documented in the corresponding API module document.

---

# 14. HTTP Status Codes

WriteSpace uses standard HTTP status codes.

| Status | Meaning               | Typical Usage                     |
| ------ | --------------------- | --------------------------------- |
| 200    | OK                    | Successful request                |
| 201    | Created               | Resource successfully created     |
| 400    | Bad Request           | Invalid request                   |
| 401    | Unauthorized          | Missing/invalid authentication    |
| 403    | Forbidden             | Authenticated but not allowed     |
| 404    | Not Found             | Resource does not exist           |
| 409    | Conflict              | Duplicate/conflicting resource    |
| 422    | Unprocessable Entity  | Validation failure, if applicable |
| 429    | Too Many Requests     | Rate limit exceeded               |
| 500    | Internal Server Error | Unexpected server failure         |

The actual status code returned by each endpoint should be verified during API testing.

---

# 15. Error Handling

API errors should be handled consistently through the application's error-handling mechanism.

An error response should provide enough information for the client to understand the failure without exposing sensitive internal information.

Typical error categories include:

```text
Validation Error
Authentication Error
Authorization Error
Resource Not Found
Conflict
Rate Limit
Internal Server Error
External Service Error
```

Detailed error behavior is documented in:

```text
04-API-Design/07-API-Standards-and-Errors.md
```

---

# 16. Authentication Flow

A simplified authentication flow is:

```text
Client
  │
  │ Register
  ▼
Auth API
  │
  │ Verify Email
  ▼
User Created
  │
  ▼
Access Token + Refresh Token
  │
  ├── Access Token → Authorization Header
  │
  └── Refresh Token → HTTP-only Cookie
```

During token refresh:

```text
Client
  │
  │ Refresh Request
  ▼
Auth API
  │
  ▼
Validate Refresh Token
  │
  ▼
Redis
  │
  ▼
Rotate Refresh Token
  │
  ▼
New Access Token + Refresh Token
```

---

# 17. API and Redis

Redis is used by several API workflows.

Examples include:

- Registration OTP storage
- Password-reset tokens
- Refresh-token storage
- Token rotation
- Temporary authentication data
- Other high-speed/temporary data

Redis usage should be documented in the relevant API and infrastructure documentation.

---

# 18. API and Database

Persistent application data is stored in PostgreSQL.

The API interacts with the database through the application's data-access layer.

Examples include:

```text
Users
Posts
Comments
Reactions
Follows
Saves
Shares
Notifications
```

The API layer should not directly expose database implementation details to clients.

---

# 19. API and Event-Driven Architecture

Some operations generate domain/application events.

For example:

```text
User Interaction
      │
      ▼
Interaction Service
      │
      ▼
Interaction Created
      │
      ▼
Event Published
      │
      ├── Notification
      ├── Analytics
      ├── Future Recommendation System
      └── Future AI/ML Processing
```

This architecture provides a foundation for future features such as:

- Personalized feeds
- Content recommendations
- Interaction-based ranking
- User-interest profiling
- Semantic search
- Content discovery

---

# 20. API Request Lifecycle

A typical request follows:

```text
Client
  ↓
Express Application
  ↓
Route
  ↓
Rate Limiter
  ↓
Authentication Middleware
  ↓
Validation Middleware
  ↓
Controller
  ↓
Service
  ↓
Repository / Database / Redis / Event System
  ↓
Service Result
  ↓
Controller
  ↓
HTTP Response
```

Not every endpoint uses every middleware.

The exact middleware chain should be documented for each API.

---

# 21. API Security Considerations

The API security model includes:

- JWT-based authentication
- HTTP-only refresh-token cookies
- Password hashing
- Request validation
- Rate limiting
- Account-status checks
- Refresh-token rotation
- Refresh-token revocation
- Generic authentication error messages
- OAuth authentication
- Protection against unauthorized resource access

Security-related implementation details are documented separately in:

```text
07-Cross-Cutting-Concerns/07-Security.md
```

---

# 22. API Documentation Convention

Every module-specific API document should document endpoints using a consistent format.

Each endpoint should contain:

```text
1. Endpoint Name
2. Purpose
3. HTTP Method
4. URL
5. Authentication
6. Authorization
7. Rate Limiting
8. Request Headers
9. Path Parameters
10. Query Parameters
11. Request Body
12. Validation Rules
13. Success Response
14. Error Responses
15. Controller Flow
16. Service Flow
17. Database Interaction
18. Redis Interaction
19. Events / Side Effects
20. Security Considerations
21. Testing Reference
```

---

# 23. API Testing Relationship

API documentation describes the expected contract.

Testing documentation verifies whether the implementation satisfies that contract.

For example:

```text
API Design
    │
    │ Expected behavior
    ▼
Authentication API Documentation
    │
    ▼
Postman Testing
    │
    │ Actual behavior
    ▼
PASS / FAIL
    │
    ├── PASS → Document verified behavior
    │
    └── FAIL → Record bug
                  │
                  ▼
               Fix later
                  │
                  ▼
             Regression Test
```

Authentication API testing is documented in:

```text
10-Testing/02-Authentication/01-Authentication-API-Testing.md
```

---

# 24. API Documentation Principles

The WriteSpace API documentation should follow these principles:

### Contract First

Document what the endpoint accepts and returns.

### Implementation Aware

Explain important controller, service, database, Redis, and event interactions.

### Testable

Every documented behavior should be verifiable through testing.

### Security Conscious

Document authentication, authorization, validation, rate limiting, and sensitive-data handling.

### Maintainable

Avoid duplicating implementation details across multiple documents.

### Interview Friendly

Documentation should make it possible to explain both:

```text
"What does this API do?"
```

and:

```text
"How does this API work internally?"
```
