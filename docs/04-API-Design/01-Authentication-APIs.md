# Authentication APIs

## 1. Overview

The Authentication module is responsible for user identity, account authentication, token management, password management, and OAuth authentication.

Base path:

```text
/api/v1/auth
```

The module currently supports:

- Registration
- Email verification
- Login
- Access-token authentication
- Refresh-token rotation
- Logout
- Forgot password
- Reset password
- Update password
- Google OAuth
- GitHub OAuth

---

# 2. Authentication Architecture

The authentication flow follows:

```text
Client
   │
   ▼
Auth Route
   │
   ▼
Middleware
   │
   ├── Rate Limiting
   ├── Validation
   └── Authentication
   │
   ▼
Auth Controller
   │
   ▼
Auth Service
   │
   ├── PostgreSQL
   ├── Redis
   ├── JWT
   ├── Email Service
   └── OAuth Provider
```

---

# 3. Authentication Components

The Authentication module contains:

```text
auth.routes.ts
auth.controller.ts
auth.service.ts
dtos/
interfaces/
```

### Route Layer

Responsible for:

- Defining endpoints
- Connecting middleware
- Connecting controller methods

### Controller Layer

Responsible for:

- Reading HTTP request data
- Calling the service
- Setting cookies
- Returning HTTP responses
- Redirecting OAuth requests

### Service Layer

Responsible for:

- Authentication logic
- Password hashing
- Token generation
- Redis operations
- Database operations
- Account-status checks
- OAuth handling
- Email side effects

### DTO Layer

Responsible for request validation.

---

# 4. Authentication API Inventory

| Method | Endpoint                | Purpose                 | Authentication |
| ------ | ----------------------- | ----------------------- | -------------- |
| POST   | `/auth/register`        | Start registration      | Public         |
| POST   | `/auth/verify-email`    | Verify registration OTP | Public         |
| POST   | `/auth/login`           | Login user              | Public         |
| POST   | `/auth/forgot-password` | Request password reset  | Authenticated  |
| POST   | `/auth/reset-password`  | Reset password          | Public         |
| PUT    | `/auth/update-password` | Change password         | Required       |
| POST   | `/auth/refresh-token`   | Refresh access token    | Refresh token  |
| POST   | `/auth/logout`          | Logout                  | Refresh token  |
| GET    | `/auth/google`          | Start Google OAuth      | Public         |
| GET    | `/auth/google/callback` | Google OAuth callback   | OAuth          |
| GET    | `/auth/github`          | Start GitHub OAuth      | Public         |
| GET    | `/auth/github/callback` | GitHub OAuth callback   | OAuth          |

---

# 5. Common Authentication Concepts

## 5.1 Access Token

The access token is a short-lived JWT used to authenticate protected API requests.

Example:

```http
Authorization: Bearer <access-token>
```

The JWT payload contains:

```json
{
  "id": "user-id",
  "role": "user"
}
```

---

## 5.2 Refresh Token

Refresh tokens are used to obtain new access tokens.

WriteSpace stores refresh-token records in Redis.

Conceptually:

```text
refresh_token:<userId>:<refreshToken>
```

The refresh token has a lifetime of:

```text
7 days
```

---

## 5.3 Refresh Token Rotation

When a refresh token is used:

```text
Old Refresh Token
        │
        ▼
Redis GET + DELETE
        │
        ▼
Validate
        │
        ▼
Generate New Tokens
        │
        ▼
Store New Refresh Token
```

The old refresh token cannot be reused after successful rotation.

---

# 6. API: Register

## Endpoint

```http
POST /api/v1/auth/register
```

## Purpose

Initiates user registration by validating the supplied user information, generating an OTP, temporarily storing the registration data in Redis, and sending the verification OTP.

## Authentication

```text
Public
```

## Middleware

```text
registerLimiter
validate(registerSchema)
```

## Request Headers

```http
Content-Type: application/json
```

## Request Body

```json
{
  "fullname": "Md Afzal Ansari",
  "username": "afzal",
  "email": "afzal@example.com",
  "password": "Password123"
}
```

## Validation

### fullname

```text
Minimum length: 3
```

### username

```text
Minimum length: 3
```

### email

```text
Must be a valid email
```

### password

Requirements:

```text
Minimum 8 characters
At least one uppercase letter
At least one lowercase letter
At least one number
```

## Processing Flow

```text
Request
  ↓
Rate Limiter
  ↓
Validation
  ↓
Check email/username
  ↓
Generate OTP
  ↓
Store registration data in Redis
  ↓
Send OTP email
  ↓
Return response
```

## Redis

Registration information is temporarily stored using:

```text
auth:register:<email>
```

TTL:

```text
60 seconds
```

## Success Response

Expected status:

```http
200 OK
```

Example:

```json
{
  "message": "Verification OTP sent successfully"
}
```

The exact response should be verified against the running implementation.

## Important Code

The registration service:

```ts
const otp = generateOtp();

await redis.set(
  `auth:register:${data.email}`,
  JSON.stringify({
    ...data,
    otp,
  }),
  "EX",
  OTP_EXPIRE_SEC,
);
```

The password is not hashed at this stage because the user has not yet been successfully verified.

Password hashing occurs during registration verification.

---

# 7. API: Verify Email

## Endpoint

```http
POST /api/v1/auth/verify-email
```

## Purpose

Verifies the registration OTP and creates the user account.

## Authentication

```text
Public
```

## Middleware

```text
emailActionLimiter
validate(verifyOtpSchema)
```

## Request Body

```json
{
  "email": "afzal@example.com",
  "otp": "123456"
}
```

## Validation

```text
email → valid email
otp   → exactly 6 characters
```

## Processing Flow

```text
Request
  ↓
Validation
  ↓
Retrieve auth:register:<email>
  ↓
Compare OTP
  ↓
Hash Password
  ↓
Create User
  ↓
Delete Registration Data
  ↓
Generate Access + Refresh Tokens
  ↓
Send Welcome Email
  ↓
Return User + Access Token
```

## Redis

The registration key is deleted after successful verification.

```text
auth:register:<email>
```

## Success Response

Expected status:

```http
201 Created
```

Response contains:

```json
{
  "user": {},
  "accessToken": "<access-token>"
}
```

The refresh token is returned through an HTTP-only cookie.

## Important Security Behavior

The password is hashed using bcrypt before being stored in PostgreSQL.

Configured bcrypt cost:

```text
12
```

---

# 8. API: Login

## Endpoint

```http
POST /api/v1/auth/login
```

## Authentication

```text
Public
```

## Middleware

```text
loginLimiter
validate(loginSchema)
```

## Request Body

```json
{
  "email": "afzal@example.com",
  "password": "Password123"
}
```

## Processing Flow

```text
Request
  ↓
Rate Limiter
  ↓
Validation
  ↓
Find User
  ↓
Verify Password
  ↓
Check Account Status
  ↓
Generate Tokens
  ↓
Store Refresh Token
  ↓
Send Login Alert
  ↓
Return Response
```

## Account Status

The authentication service prevents banned or suspended accounts from logging in.

Expected response:

```http
403 Forbidden
```

for inactive restricted accounts.

## Success Response

Expected:

```http
200 OK
```

Example:

```json
{
  "user": {},
  "accessToken": "<access-token>"
}
```

The refresh token is set as an HTTP-only cookie.

---

# 9. API: Refresh Token

## Endpoint

```http
POST /api/v1/auth/refresh-token
```

## Authentication

```text
Refresh token required
```

The endpoint first checks the refresh-token cookie.

A request body token is also supported by the current implementation.

## Processing Flow

```text
Request
  ↓
Read Refresh Token
  ↓
Verify JWT
  ↓
Lookup Redis Token
  ↓
GET + DELETE Existing Token
  ↓
Load User
  ↓
Check Account Status
  ↓
Generate New Tokens
  ↓
Store New Refresh Token
  ↓
Set New Cookie
  ↓
Return New Access Token
```

## Redis

Refresh tokens are stored using:

```text
refresh_token:<userId>:<refreshToken>
```

## Rotation

The implementation uses:

```ts
redis.getDel();
```

This makes the refresh token single-use.

## Success Response

```http
200 OK
```

Example:

```json
{
  "accessToken": "<new-access-token>"
}
```

The new refresh token is returned through the HTTP-only cookie.

## Important Security Property

After successful rotation:

```text
Old Refresh Token → Invalid
New Refresh Token → Valid
```

---

# 10. API: Logout

## Endpoint

```http
POST /api/v1/auth/logout
```

## Authentication

```text
Refresh token based
```

The endpoint does not depend on the access token being valid.

This allows logout to work even if the access token has expired.

## Processing Flow

```text
Request
  ↓
Read Refresh Cookie
  ↓
Invalidate Refresh Token
  ↓
Clear Cookie
  ↓
Return Success
```

## Success Response

```http
200 OK
```

Example:

```json
{
  "message": "Logged out successfully"
}
```

## Important Implementation Detail

The controller does not rely on `req.user` because the access token may already be expired.

---

# 11. API: Forgot Password

## Endpoint

```http
POST /api/v1/auth/forgot-password
```

## Authentication

Current implementation:

```text
Required
```

## Middleware

```text
emailActionLimiter
authenticate
validate(forgotPasswordSchema)
```

## Request Body

```json
{
  "email": "afzal@example.com"
}
```

## Processing Flow

```text
Request
  ↓
Authenticate
  ↓
Validate Email
  ↓
Find User
  ↓
Generate Reset Token
  ↓
Store Token in Redis
  ↓
Send Reset Email
  ↓
Return Generic Response
```

## Redis

```text
password_reset:<token>
```

TTL:

```text
1 hour
```

## Security Behavior

If the email does not belong to an existing account, the service returns the same generic message.

This helps reduce user-account enumeration.

## Important Observation

The current implementation requires authentication for this endpoint.

This should be explicitly tested and documented as an implementation behavior.

---

# 12. API: Reset Password

## Endpoint

```http
POST /api/v1/auth/reset-password
```

## Authentication

```text
Public
```

The reset token acts as the authorization mechanism.

## Request Body

```json
{
  "token": "<reset-token>",
  "password": "NewPassword123"
}
```

## Processing Flow

```text
Request
  ↓
Validate Input
  ↓
Lookup Reset Token in Redis
  ↓
Retrieve User
  ↓
Hash New Password
  ↓
Update Database
  ↓
Delete Reset Token
  ↓
Revoke All Refresh Tokens
  ↓
Send Password Update Email
  ↓
Return Success
```

## Security Behavior

After successful password reset:

```text
Existing Refresh Tokens → Revoked
Reset Token → Deleted
New Password → Active
```

## Success Response

```http
200 OK
```

---

# 13. API: Update Password

## Endpoint

```http
PUT /api/v1/auth/update-password
```

## Authentication

```text
Required
```

## Request Body

```json
{
  "currentPassword": "Password123",
  "newPassword": "NewPassword123"
}
```

## Processing Flow

```text
Authenticate User
  ↓
Load User
  ↓
Verify Current Password
  ↓
Hash New Password
  ↓
Update Password
  ↓
Revoke All Refresh Tokens
  ↓
Send Password Update Email
  ↓
Return Success
```

## Important Difference

The current update-password DTO requires:

```text
newPassword → minimum 8 characters
```

but does not currently enforce the same uppercase/lowercase/number rules used by registration and reset-password.

This is an implementation observation that should be verified during testing.

---

# 14. Google OAuth

## Start Endpoint

```http
GET /api/v1/auth/google
```

The request is redirected to Google authentication.

Configured scope:

```text
profile
email
```

## Callback

```http
GET /api/v1/auth/google/callback
```

## Flow

```text
Client
  ↓
Google Auth Endpoint
  ↓
Google
  ↓
Callback
  ↓
Passport
  ↓
Auth Controller
  ↓
Auth Service
  ↓
Find/Create User
  ↓
Generate Tokens
  ↓
Set Refresh Cookie
  ↓
Redirect Client
```

## Existing User

If the user already exists:

```text
Authenticate existing account
```

If the provider information is missing, it may be associated with the account.

## New User

The service creates a new account using provider information.

A generated username and password are used by the current implementation.

---

# 15. GitHub OAuth

## Start Endpoint

```http
GET /api/v1/auth/github
```

Configured scope:

```text
user:email
```

## Callback

```http
GET /api/v1/auth/github/callback
```

The overall flow is similar to Google OAuth:

```text
GitHub
  ↓
Callback
  ↓
Passport
  ↓
Auth Service
  ↓
Find/Create User
  ↓
Generate Tokens
  ↓
Set Refresh Cookie
  ↓
Redirect Client
```

---

# 16. Refresh Token Cookie

Refresh tokens are stored in an HTTP-only cookie.

Current configuration:

```ts
{
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? "none" : "lax",
  path: "/",
  maxAge: 7 * 24 * 60 * 60 * 1000
}
```

## Development

```text
httpOnly = true
secure = false
sameSite = lax
```

## Production

```text
httpOnly = true
secure = true
sameSite = none
```

---

# 17. Public User Response

The authentication service removes sensitive fields before returning user data.

The following fields are not exposed:

```text
passwordHash
googleAuth
githubAuth
```

This transformation is performed by:

```ts
toPublicUser();
```

---

# 18. Account Status Handling

Authentication checks the account status before allowing authentication-sensitive operations.

Restricted states include:

```text
banned
suspended
```

Such accounts should not be allowed to authenticate normally.

Expected response:

```http
403 Forbidden
```

---

# 19. Rate Limiting

Authentication endpoints use dedicated rate limiters.

### Registration

```text
registerLimiter
```

### Login

```text
loginLimiter
```

### Email-related actions

```text
emailActionLimiter
```

These protect sensitive endpoints against abuse.

---

# 20. Authentication Redis Keys

| Key                              | Purpose                           | TTL        |
| -------------------------------- | --------------------------------- | ---------- |
| `auth:register:<email>`          | Temporary registration data + OTP | 60 seconds |
| `refresh_token:<userId>:<token>` | Refresh-token storage             | 7 days     |
| `password_reset:<token>`         | Password reset authorization      | 1 hour     |

---

# 21. Authentication Security Properties

The current authentication implementation provides:

- Password hashing using bcrypt
- JWT access tokens
- Redis-backed refresh tokens
- Refresh-token rotation
- HTTP-only refresh cookies
- Refresh-token revocation
- Password-reset token expiration
- OTP expiration
- Account-status checks
- Rate limiting
- OAuth authentication
- Sensitive user-field removal
- Generic forgot-password response

---

# 22. Important Implementation Observations

The following are observations that should be verified during API testing before considering them bugs.

### Forgot Password Authentication

The current route requires authentication:

```ts
authenticate;
```

This should be verified against the intended product behavior.

### Password Validation

Registration and reset-password enforce:

```text
uppercase
lowercase
number
minimum 8 characters
```

Update-password currently enforces only:

```text
minimum 8 characters
```

This difference should be tested.

### OTP Validation

The OTP schema currently checks:

```text
length = 6
```

but should be tested to determine whether non-numeric six-character values are accepted.

### Refresh Token Sources

The refresh endpoint supports:

```text
HTTP-only cookie
```

and a fallback body token.

This should be verified and documented as an intentional design choice or future security improvement.

### OAuth Access Token Redirect

The OAuth callback currently redirects with the access token in the URL:

```text
/auth/success?token=<access-token>
```

This should be reviewed from a security perspective.

---

# 23. Testing Reference

Authentication API behavior is verified separately from this API contract.

Testing document:

```text
10-Testing/02-Authentication/01-Authentication-API-Testing.md
```

The testing document records:

- Test cases
- Requests
- Expected responses
- Actual responses
- Database state
- Redis state
- Cookies
- Side effects
- Bugs
- Fixes
- Regression tests

---

# 24. Authentication API Test Categories

The authentication APIs should be tested across:

### Registration

```text
Valid registration
Duplicate email
Duplicate username
Invalid fields
Weak password
Rate limit
```

### Email Verification

```text
Valid OTP
Invalid OTP
Expired OTP
Invalid OTP format
Already verified / reused OTP
```

### Login

```text
Valid credentials
Wrong password
Unknown email
Invalid input
Suspended account
Banned account
Rate limiting
```

### Token Management

```text
Valid refresh
Expired refresh
Invalid refresh
Reused refresh
Missing refresh
Token rotation
Logout
```

### Password Management

```text
Forgot password
Unknown email
Invalid reset token
Expired reset token
Reused reset token
Valid password reset
Update password
Wrong current password
Weak new password
```

### OAuth

```text
Google login
Google callback
Existing Google user
New Google user
GitHub login
GitHub callback
Existing GitHub user
New GitHub user
```

---

# 25. API Contract vs Implementation

This document describes the current Authentication API contract and important implementation behavior.

The testing process determines whether the actual running application behaves according to this documentation.

If a mismatch is discovered:

```text
Documented Behavior
        │
        ▼
Actual Behavior
        │
        ├── Same → PASS
        │
        └── Different
              │
              ▼
        Investigate
              │
        ┌─────┴─────┐
        ▼           ▼
   Documentation   Bug
      Issue         │
                    ▼
                  Fix
                    │
                    ▼
              Regression Test
```
