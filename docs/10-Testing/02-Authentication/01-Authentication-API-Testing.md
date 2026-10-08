# Authentication API

# 1. Overview

The Authentication module is responsible for managing user authentication, account registration, email verification, password management, session management, token generation, and third-party OAuth authentication.

The module currently supports:

- User registration
- Email/OTP verification
- User login
- Access token generation
- Refresh token rotation
- Logout
- Password update
- Forgot-password flow
- Password reset
- Google OAuth
- GitHub OAuth
- Authentication middleware integration
- Authentication-related rate limiting

The authentication system uses:

| Component            | Responsibility                                         |
| -------------------- | ------------------------------------------------------ |
| Express.js           | HTTP routing and request handling                      |
| Zod                  | Request validation                                     |
| JWT                  | Access and refresh token generation                    |
| bcrypt               | Password hashing and verification                      |
| Redis                | OTP, refresh-token, and password-reset-token storage   |
| PostgreSQL           | Persistent user storage                                |
| Passport             | Google/GitHub OAuth                                    |
| Notification Service | OTP, welcome, login-alert, and password-related emails |

---

# 2. Base URL

For local development:

```text
http://localhost:8000/api/v1
```

Therefore, Authentication endpoints are exposed under:

```text
http://localhost:8000/api/v1/auth
```

Example:

```http
POST http://localhost:8000/api/v1/auth/login
```

---

# 3. Authentication API Inventory

| Method | Endpoint                | Authentication | Purpose                       |
| ------ | ----------------------- | -------------- | ----------------------------- |
| POST   | `/auth/register`        | No             | Initiate user registration    |
| POST   | `/auth/verify-email`    | No             | Verify OTP and create account |
| POST   | `/auth/login`           | No             | Authenticate user             |
| POST   | `/auth/forgot-password` | Yes            | Initiate password reset       |
| POST   | `/auth/reset-password`  | No             | Reset password                |
| PUT    | `/auth/update-password` | Yes            | Change current password       |
| POST   | `/auth/refresh-token`   | Refresh Token  | Generate new access token     |
| POST   | `/auth/logout`          | No             | Invalidate refresh session    |
| GET    | `/auth/google`          | No             | Start Google OAuth            |
| GET    | `/auth/google/callback` | OAuth          | Handle Google OAuth callback  |
| GET    | `/auth/github`          | No             | Start GitHub OAuth            |
| GET    | `/auth/github/callback` | OAuth          | Handle GitHub OAuth callback  |

---

# 4. Authentication Architecture

The authentication module follows a layered request flow:

```text
Client
   │
   ▼
Auth Route
   │
   ├── Rate Limiter
   │
   ├── Validation Middleware
   │
   ├── Authentication Middleware
   │
   ▼
Auth Controller
   │
   ▼
Auth Service
   │
   ├───────────────┐
   ▼               ▼
PostgreSQL       Redis
   │               │
   │               ├── OTP
   │               ├── Refresh Tokens
   │               └── Password Reset Tokens
   │
   ▼
Notification Service
```

The route layer is responsible for composing middleware and mapping HTTP requests to controller methods.

The controller is responsible for:

- Reading request data
- Calling the service
- Setting cookies
- Constructing HTTP responses
- Passing errors to Express error handling

The service contains the authentication business logic.

---

# 5. Token Architecture

WriteSpace currently uses two JWT tokens.

## 5.1 Access Token

The access token is returned in the API response.

Example:

```json
{
  "accessToken": "eyJ..."
}
```

It contains:

```typescript
{
  id: userId,
  role: userRole
}
```

The access token is used to authenticate protected APIs.

Example:

```http
Authorization: Bearer <access-token>
```

---

## 5.2 Refresh Token

The refresh token is stored in an HTTP-only cookie.

Cookie name:

```text
refreshToken
```

Current configuration:

```typescript
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? "none" : "lax",
  path: "/",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};
```

The refresh token is also stored server-side in Redis.

Redis key:

```text
refresh_token:{userId}:{refreshToken}
```

The refresh token lifetime is:

```text
7 days
```

---

# 6. Registration Flow

Registration is intentionally implemented as a two-step process.

```text
POST /auth/register
        │
        ▼
Validate Registration Data
        │
        ▼
Check Existing User
        │
        ▼
Generate OTP
        │
        ▼
Store Registration Data in Redis
        │
        ▼
Send OTP Email
        │
        ▼
POST /auth/verify-email
        │
        ▼
Verify OTP
        │
        ▼
Hash Password
        │
        ▼
Create User
        │
        ▼
Generate Tokens
        │
        ▼
Send Welcome Email
```

The user is **not created in PostgreSQL during the first registration request**.

The account is created only after successful OTP verification.

---

# 7. POST `/auth/register`

## Purpose

Initiates user registration by validating the registration information, checking whether the email or username already exists, generating an OTP, temporarily storing the registration information in Redis, and sending the OTP to the user's email.

## Authentication

Not required.

## Rate Limiting

The endpoint uses:

```typescript
registerLimiter;
```

#### Request

```bash
POST {{baseUrl}}/auth/register
```

#### Headers

```http
Content-Type: application/json
```

#### Request Body

```json
{
  "fullname": "Afzal Test",
  "username": "afzal_test",
  "email": "afzal.test@example.com",
  "password": "TestPassword1"
}
```

### Validation Rules

The request is validated using `registerSchema`.

| Field      | Type   | Requirement            |
| ---------- | ------ | ---------------------- |
| `fullname` | string | Minimum 3 characters   |
| `username` | string | Minimum 3 characters   |
| `email`    | string | Valid email            |
| `password` | string | Minimum 8 characters   |
| `password` | string | Must contain uppercase |
| `password` | string | Must contain lowercase |
| `password` | string | Must contain number    |

### Important Implementation

```typescript
const [existingUser] = await db
  .select({ id: users.id })
  .from(users)
  .where(or(eq(users.email, data.email), eq(users.username, data.username)))
  .limit(1);
```

The service checks both email and username before starting registration.

OTP generation:

```typescript
const otp = generateOTP(6);
```

Registration data is temporarily stored in Redis:

```typescript
await redis.set(
  `auth:register:${data.email}`,
  JSON.stringify(registrationData),
  { EX: OTP_EXPIRE_SEC },
);
```

Current OTP expiration:

```typescript
const OTP_EXPIRE_SEC = 60;
```

Therefore:

```text
OTP lifetime = 60 seconds
```

#### Successful Response

HTTP Status:

```text
200 OK
```

Response:

```json
{
    "success": true,
    "statusCode": 200,
    "message": "OTP sent to email. Please verify to complete registration.",
    "data": null,
    "timestamp": "2026-10-08T13:44:14.552Z"
}
```

### Database Effect

No user is created yet.

The registration information is temporarily stored in Redis.

```text
PostgreSQL
└── No new user

Redis
└── auth:register:{email}
```

### Email Effect

An OTP email is sent using:

```typescript
notificationService.sendOtpEmail(data.email, otp);
```

### Verify Email  

#### Request 
```bash
POST {{bashUrl}}/auth/verify-email  
```  

#### Headers  

```http
Content-Type: application/json
```  

#### Request Body  
```json
{
  "email": "iamafzal.tech@gmail.com",
  "otp": "123456"
}
```  
#### Status  

```json
200
```  

#### Response   

**user register successfully**
```json
{
    "success": true,
    "statusCode": 201,
    "message": "Registration successful",
    "data": {
        "user": {
            "id": "44b3257b-9b5a-4f46-9204-f175b69fda84",
            "fullname": "Afzal Test",
            "email": "iamafzal.tech@gmail.com",
            "username": "afzal_test",
            "bio": "",
            "headline": "",
            "location": "",
            "profileImageUrl": "https://api.dicebear.com/7.x/adventurer/svg?seed=mail",
            "profileImagePublicId": "",
            "bannerImageUrl": "",
            "bannerImagePublicId": "",
            "youtube": "",
            "instagram": "",
            "facebook": "",
            "twitter": "",
            "github": "",
            "website": "",
            "linkedin": "",
            "leetcode": "",
            "geeksforgeeks": "",
            "codeforces": "",
            "totalPosts": 0,
            "totalReads": 0,
            "totalFollowers": 0,
            "totalFollowing": 0,
            "status": "active",
            "role": "user",
            "loginAttempts": 0,
            "lockUntil": null,
            "createdAt": "2026-10-08T13:59:08.960Z",
            "updatedAt": "2026-10-08T13:59:08.960Z"
        },
        "accessToken": "eyJhbGciOi..."
    },
    "timestamp": "2026-10-08T13:59:08.987Z"
}
```

### Possible Errors

#### Duplicate Email or Username

#### Request (with the same email id)  

#### Request Body   

> **note:** sending same request again   

```json
{
  "fullname": "Afzal Test",
  "username": "afzal_test",
  "email": "iamafzal.tech@gmail.com",
  "password": "TestPassword1"
}

```
#### Status Code   
```json
409
```
#### Response Body 
```json
{
    "success": false,
    "message": "Email or Username already exists",
    "stack": "Error: Email or Username already exists\n    at AuthService.initiateRegistration (/home/iamafzal/projects/social_media/writespace/src/modules/auth/auth.service.ts:47:13)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at async register (/home/iamafzal/projects/social_media/writespace/src/modules/auth/auth.controller.ts:36:22)"
}
```  

### Rate Limiting   

#### Too many request   

**status code**  
```json
429
```
#### Request body

```json
{
  "fullname": "Afzal Test",
  "username": "afzal",
  "email": "iamafzal.@abc",
  "password": "TestPassword1"
}
```

#### Response body  
```json
{
    "success": false,
    "message": "Too many accounts created from this IP. Please try again after an hour",
    "data": null
}
```

### Invalid Request

Validation middleware rejects malformed input.

Examples:

- Invalid email
- Missing fullname
- Short username
- Weak password

#### Invalid request responses   

**invalid email address**  

#### request body  

```json
{
  "username": "afzal",
  "email": "iamafzal.@abc",  # pain in ass
  "password": "TestPassword1"
}
```  

#### response body  

```json
{
    "success": false,
    "message": "Validation failed",
    "errors": {
        "formErrors": [],
        "fieldErrors": {
            "body": [
                "Required",
                "Invalid email address"
            ]
        }
    },
    "stack": "ZodError: [\n  {\n    \"code\": \"invalid_type\",\n    \"expected\": \"string\",\n    \"received\": \"undefined\",\n    \"path\": [\n      \"body\",\n      \"fullname\"\n    ],\n    \"message\": \"Required\"\n  },\n  {\n    \"validation\": \"email\",\n    \"code\": \"invalid_string\",\n    \"message\": \"Invalid email address\",\n    \"path\": [\n      \"body\",\n      \"email\"\n    ]\n  }\n]\n    at Object.get error [as error] (/home/iamafzal/projects/social_media/writespace/node_modules/zod/lib/types.js:55:31)\n    at ZodObject.parse (/home/iamafzal/projects/social_media/writespace/node_modules/zod/lib/types.js:160:22)\n    at /home/iamafzal/projects/social_media/writespace/src/shared/middlewares/validate.middleware.ts:8:29\n    at Layer.handleRequest (/home/iamafzal/projects/social_media/writespace/node_modules/router/lib/layer.js:152:17)\n    at next (/home/iamafzal/projects/social_media/writespace/node_modules/router/lib/route.js:157:13)\n    at Route.dispatch (/home/iamafzal/projects/social_media/writespace/node_modules/router/lib/route.js:117:3)\n    at handle (/home/iamafzal/projects/social_media/writespace/node_modules/router/index.js:435:11)\n    at Layer.handleRequest (/home/iamafzal/projects/social_media/writespace/node_modules/router/lib/layer.js:152:17)\n    at /home/iamafzal/projects/social_media/writespace/node_modules/router/index.js:295:15\n    at processParams (/home/iamafzal/projects/social_media/writespace/node_modules/router/index.js:582:12)"
}
```

**missing fullname**  

**status code**  
```json
400
```
#### request body  

```json  
{
  # fullname -> pain in ass
  "username": "afzal",
  "email": "iamafzal.tech@gmail.com",
  "password": "TestPassword1"
}

```

#### response body  

```json
{
    "success": false,
    "message": "Validation failed",
    "errors": {
        "formErrors": [],
        "fieldErrors": {
            "body": [
                "Required"
            ]
        }
    },
    "stack": "ZodError: [\n  {\n    \"code\": \"invalid_type\",\n    \"expected\": \"string\",\n    \"received\": \"undefined\",\n    \"path\": [\n      \"body\",\n      \"fullname\"\n    ],\n    \"message\": \"Required\"\n  }\n]\n    at Object.get error [as error] (/home/iamafzal/projects/social_media/writespace/node_modules/zod/lib/types.js:55:31)\n    at ZodObject.parse (/home/iamafzal/projects/social_media/writespace/node_modules/zod/lib/types.js:160:22)\n    at /home/iamafzal/projects/social_media/writespace/src/shared/middlewares/validate.middleware.ts:8:29\n    at Layer.handleRequest (/home/iamafzal/projects/social_media/writespace/node_modules/router/lib/layer.js:152:17)\n    at next (/home/iamafzal/projects/social_media/writespace/node_modules/router/lib/route.js:157:13)\n    at Route.dispatch (/home/iamafzal/projects/social_media/writespace/node_modules/router/lib/route.js:117:3)\n    at handle (/home/iamafzal/projects/social_media/writespace/node_modules/router/index.js:435:11)\n    at Layer.handleRequest (/home/iamafzal/projects/social_media/writespace/node_modules/router/lib/layer.js:152:17)\n    at /home/iamafzal/projects/social_media/writespace/node_modules/router/index.js:295:15\n    at processParams (/home/iamafzal/projects/social_media/writespace/node_modules/router/index.js:582:12)"
}
```  

**short username**  

**status code**  
```json
400
```

#### request body  

```json
{
    "fullname": "Afzal Test",
    "username": "ab",  # pain in ass
    "email": "iamafzal.tech@gmail.com",
    "password": "TestPassword1"
}

```  

#### response body  

```json
{
    "success": false,
    "message": "Validation failed",
    "errors": {
        "formErrors": [],
        "fieldErrors": {
            "body": [
                "Username must be at least 3 characters"
            ]
        }
    },
    "stack": "ZodError: [\n  {\n    \"code\": \"too_small\",\n    \"minimum\": 3,\n    \"type\": \"string\",\n    \"inclusive\": true,\n    \"exact\": false,\n    \"message\": \"Username must be at least 3 characters\",\n    \"path\": [\n      \"body\",\n      \"username\"\n    ]\n  }\n]\n    at Object.get error [as error] (/home/iamafzal/projects/social_media/writespace/node_modules/zod/lib/types.js:55:31)\n    at ZodObject.parse (/home/iamafzal/projects/social_media/writespace/node_modules/zod/lib/types.js:160:22)\n    at /home/iamafzal/projects/social_media/writespace/src/shared/middlewares/validate.middleware.ts:8:29\n    at Layer.handleRequest (/home/iamafzal/projects/social_media/writespace/node_modules/router/lib/layer.js:152:17)\n    at next (/home/iamafzal/projects/social_media/writespace/node_modules/router/lib/route.js:157:13)\n    at Route.dispatch (/home/iamafzal/projects/social_media/writespace/node_modules/router/lib/route.js:117:3)\n    at handle (/home/iamafzal/projects/social_media/writespace/node_modules/router/index.js:435:11)\n    at Layer.handleRequest (/home/iamafzal/projects/social_media/writespace/node_modules/router/lib/layer.js:152:17)\n    at /home/iamafzal/projects/social_media/writespace/node_modules/router/index.js:295:15\n    at processParams (/home/iamafzal/projects/social_media/writespace/node_modules/router/index.js:582:12)"
}
```

**weak password**  

**status code**
```json
400
```

#### request body   

```json
{
    "fullname": "Afzal Test",
    "username": "afzal_123",
    "email": "iamafzal.tech@gmail.com",
    "password": "ABCDEFGH"  # pain in ass 
}

```

#### request response  

```json
{
    "success": false,
    "message": "Validation failed",
    "errors": {
        "formErrors": [],
        "fieldErrors": {
            "body": [
                "Password must contain at least one lowercase letter",
                "Password must contain at least one number"
            ]
        }
    },
    "stack": "ZodError: [\n  {\n    \"validation\": \"regex\",\n    \"code\": \"invalid_string\",\n    \"message\": \"Password must contain at least one lowercase letter\",\n    \"path\": [\n      \"body\",\n      \"password\"\n    ]\n  },\n  {\n    \"validation\": \"regex\",\n    \"code\": \"invalid_string\",\n    \"message\": \"Password must contain at least one number\",\n    \"path\": [\n      \"body\",\n      \"password\"\n    ]\n  }\n]\n    at Object.get error [as error] (/home/iamafzal/projects/social_media/writespace/node_modules/zod/lib/types.js:55:31)\n    at ZodObject.parse (/home/iamafzal/projects/social_media/writespace/node_modules/zod/lib/types.js:160:22)\n    at /home/iamafzal/projects/social_media/writespace/src/shared/middlewares/validate.middleware.ts:8:29\n    at Layer.handleRequest (/home/iamafzal/projects/social_media/writespace/node_modules/router/lib/layer.js:152:17)\n    at next (/home/iamafzal/projects/social_media/writespace/node_modules/router/lib/route.js:157:13)\n    at Route.dispatch (/home/iamafzal/projects/social_media/writespace/node_modules/router/lib/route.js:117:3)\n    at handle (/home/iamafzal/projects/social_media/writespace/node_modules/router/index.js:435:11)\n    at Layer.handleRequest (/home/iamafzal/projects/social_media/writespace/node_modules/router/lib/layer.js:152:17)\n    at /home/iamafzal/projects/social_media/writespace/node_modules/router/index.js:295:15\n    at processParams (/home/iamafzal/projects/social_media/writespace/node_modules/router/index.js:582:12)"
}
```

## Testing

### AUTH-001 — Valid Registration

```text
Status: Done
Response: Done
Redis entry: Done
Email sent: Done
Database user created: Done
```

### AUTH-002 — Duplicate Email

```text
Status: Done
Expected: 409
Actual: Done
```

### AUTH-003 — Duplicate Username

```text
Status: Done
Expected: 409
Actual: Done
```

### AUTH-004 — Validation

```text
Missing fields: Done
Invalid email: Done
Weak password: Done
Short username: Done
Short fullname: Done
```

---

# 8. POST `/auth/verify-email`

## Purpose

Verifies the OTP generated during registration and creates the user account.

## Authentication

Not required.

## Request

```http
POST {{baseUrl}}/auth/verify-email
```

### Headers

```http
Content-Type: application/json
```

### Body

```json
{
  "email": "afzal.test@example.com",
  "otp": "123456"
}
```

## Validation

| Field   | Requirement          |
| ------- | -------------------- |
| `email` | Valid email          |
| `otp`   | Exactly 6 characters |

## Important Implementation

Registration data is retrieved from Redis:

```typescript
const cachedData = await redis.get(`auth:register:${email}`);
```

OTP is then compared:

```typescript
if (data.otp !== otp) {
  throw new AppError(HTTP_STATUS.BAD_REQUEST, "Invalid OTP");
}
```

After successful verification, the password is hashed:

```typescript
const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);
```

The user is then inserted into PostgreSQL.

## Successful Response

HTTP Status:

```text
201 Created
```

Example:

```json
{
  "user": {
    "id": "...",
    "fullname": "Afzal Test",
    "username": "afzal_test",
    "email": "afzal.test@example.com"
  },
  "accessToken": "eyJ..."
}
```

A refresh token is also issued as an HTTP-only cookie.

## Important Security Behavior

The following fields are intentionally excluded from the public response:

```text
passwordHash
googleAuth
githubAuth
```

This is handled by:

```typescript
function toPublicUser(user) {
  const { passwordHash, googleAuth, githubAuth, ...publicFields } = user;

  return publicFields;
}
```

## Redis Effect

After successful registration:

```typescript
await redis.del(`auth:register:${email}`);
```

Therefore the OTP cannot be reused.

## Testing

### AUTH-005 — Valid OTP

```text
Status: Done
User created: Done
Access token: Done
Refresh cookie: Done
Redis registration key removed: Done
Welcome email: Done
```

### AUTH-006 — Invalid OTP

Expected:

```text
400 Bad Request
```

### AUTH-007 — Expired OTP

Expected:

```text
400 Bad Request
OTP expired or invalid
```

---

# 9. POST `/auth/login`

## Purpose

Authenticates an existing user and generates an access token and refresh token.

## Authentication

Not required.

## Rate Limiting

```typescript
loginLimiter;
```

## Request

```http
POST {{baseUrl}}/auth/login
```

### Headers

```http
Content-Type: application/json
```

### Body

```json
{
  "email": "afzal.test@example.com",
  "password": "TestPassword1"
}
```

## Validation

```typescript
email: z.string().email();
password: z.string().min(1);
```

## Important Implementation

User lookup:

```typescript
const [user] = await db
  .select()
  .from(users)
  .where(eq(users.email, data.email))
  .limit(1);
```

Password verification:

```typescript
const passwordMatch = await bcrypt.compare(data.password, user.passwordHash);
```

Account status is then checked:

```typescript
this.ensureAccountIsActive(user.status);
```

## Successful Response

HTTP Status:

```text
200 OK
```

```json
{
  "user": {
    "id": "...",
    "fullname": "Afzal Test",
    "username": "afzal_test",
    "email": "afzal.test@example.com"
  },
  "accessToken": "eyJ..."
}
```

Refresh token:

```text
Set-Cookie: refreshToken=...
```

## Login Alert

A login notification is generated:

```typescript
await notificationService.sendLoginAlert(
  user.email,
  user.username,
  ip,
  user.id,
);
```

## Error Cases

### Invalid Credentials

```text
401 Unauthorized
```

```json
{
  "message": "Invalid email or password"
}
```

The same message is used when:

- User doesn't exist
- Password is incorrect

This avoids revealing whether an email exists.

### Banned Account

```text
403 Forbidden
```

```text
Your account has been banned
```

### Suspended Account

```text
403 Forbidden
```

```text
Your account has been suspended
```

## Testing

```text
AUTH-009  Valid Login             Done
AUTH-010  Wrong Password          Done
AUTH-011  Unknown User            Done
AUTH-012  Invalid Request         Done
```

---

# 10. POST `/auth/refresh-token`

## Purpose

Generates a new access token using a valid refresh token.

## Authentication

Access token is not required.

A valid refresh token is required.

## Request

```http
POST {{baseUrl}}/auth/refresh-token
```

The refresh token can currently be supplied through:

1. HTTP-only cookie
2. Request body

### Body Alternative

```json
{
  "refreshToken": "eyJ..."
}
```

Normally, the cookie-based flow should be preferred.

## Important Implementation

The controller checks the cookie first:

```typescript
const refreshToken =
  cookies?.refreshToken ||
  (typeof body?.refreshToken === "string" ? body.refreshToken : undefined);
```

The service verifies the JWT:

```typescript
decoded = jwt.verify(oldRefreshToken, env.JWT_REFRESH_SECRET);
```

The refresh token is then atomically consumed from Redis:

```typescript
const isValid = await redis.getDel(redisKey);
```

This provides refresh-token rotation.

## Successful Response

```text
200 OK
```

```json
{
  "accessToken": "new-access-token"
}
```

A new refresh token is set in the cookie.

## Important Behavior

The old refresh token becomes invalid after successful refresh.

```text
Old Refresh Token
        │
        ▼
     getDel()
        │
        ▼
     consumed
        │
        ▼
New Refresh Token
```

## Error Cases

Missing token:

```text
401 Unauthorized
Refresh Token required
```

Invalid JWT:

```text
401 Unauthorized
Invalid Refresh Token
```

Previously consumed token:

```text
401 Unauthorized
Session expired or invalid
```

---

# 11. POST `/auth/logout`

## Purpose

Invalidates the current refresh-token session and clears the refresh-token cookie.

## Authentication

Access token is not required.

The refresh token is read directly from the cookie.

This allows logout to work even when the access token has expired.

## Request

```http
POST {{baseUrl}}/auth/logout
```

No body required.

## Important Implementation

```typescript
const refreshToken = cookies?.refreshToken;

if (refreshToken) {
  await authService.logout(refreshToken);
}
```

The refresh-token Redis entry is removed.

The cookie is then cleared:

```typescript
res.clearCookie("refreshToken");
```

## Successful Response

```text
200 OK
```

```json
{
  "message": "Logged out successfully"
}
```

## Verification

After logout:

```text
Old refresh token
       ↓
/refresh-token
       ↓
401 Unauthorized
```

---

# 12. PUT `/auth/update-password`

## Purpose

Allows an authenticated user to change their current password.

## Authentication

Required.

```http
Authorization: Bearer <access-token>
```

## Request

```http
PUT {{baseUrl}}/auth/update-password
```

### Body

```json
{
  "currentPassword": "TestPassword1",
  "newPassword": "NewPassword1"
}
```

## Validation

Current implementation:

```typescript
currentPassword: z.string().min(1);
newPassword: z.string().min(8);
```

Unlike registration and password reset, the current update-password schema does not enforce uppercase/lowercase/number requirements.

This should be recorded during testing as a **consistency observation**, not immediately changed.

## Important Implementation

The current password is verified using bcrypt:

```typescript
const isMatch = await bcrypt.compare(data.currentPassword, user.passwordHash);
```

The new password is hashed:

```typescript
const newPasswordHash = await bcrypt.hash(data.newPassword, SALT_ROUNDS);
```

All refresh tokens are revoked:

```typescript
await this.revokeAllRefreshTokens(userId);
```

## Successful Response

```text
200 OK
```

```json
{
  "message": "Password updated successfully"
}
```

## Important Security Behavior

Changing the password invalidates all refresh-token sessions belonging to the user.

---

# 13. POST `/auth/forgot-password`

## Purpose

Initiates the password reset process.

## Authentication

Not Required  
## Request

```http
POST {{baseUrl}}/auth/forgot-password
```

### Headers

```http
Authorization: Bearer <access-token>
Content-Type: application/json
```

### Body

```json
{
  "email": "afzal.test@example.com"
}
```

## Important Implementation

A reset token is generated:

```typescript
const resetToken = generateOTP(32);
```

It is stored in Redis:

```typescript
await redis.set(`password_reset:${resetToken}`, user.id, {
  EX: RESET_TOKEN_EXPIRE_SEC,
});
```

Current expiration:

```text
1 hour
```

A reset URL is then generated:

```typescript
const resetUrl = `${env.CLIENT_URL}/auth/reset-password?token=${resetToken}`;
```

## Successful Response

```text
200 OK
```

```json
{
    "success": true,
    "statusCode": 200,
    "message": "If that email exists, a reset link has been sent.",
    "data": null,
    "timestamp": "2026-10-08T15:15:32.090Z"
}
```

The same response is returned for an unknown email.

This prevents basic email enumeration.

---

# 14. POST `/auth/reset-password`

## Purpose

Resets the user's password using a valid password-reset token.

## Authentication

Not required.

## Request

```http
POST {{baseUrl}}/auth/reset-password
```

### Body

```json
{
  "token": "PASSWORD_RESET_TOKEN",
  "password": "ResetPassword1"
}
```

## Validation

Password must:

- contain at least 8 characters
- contain uppercase
- contain lowercase
- contain a number

## Important Implementation

The reset token is retrieved from Redis:

```typescript
const userId = await redis.get(`password_reset:${token}`);
```

After successful password update:

```typescript
await redis.del(`password_reset:${token}`);
```

All refresh tokens are revoked:

```typescript
await this.revokeAllRefreshTokens(userId);
```

## Successful Response

```text
200 OK
```

```json
{
  "message": "Password reset successful. Please log in again."
}
```

## Token Reuse

A successfully consumed reset token must not work again.

Expected:

```text
400 Bad Request
Reset token expired or invalid
```

---

# 15. GET `/auth/google`

## Purpose

Starts Google OAuth authentication.

## Request

```http
GET {{baseUrl}}/auth/google
```

This is a browser redirect flow rather than a conventional JSON API.

## Internal Flow

```text
Client
  ↓
/auth/google
  ↓
Passport Google Strategy
  ↓
Google
  ↓
User Authentication
  ↓
/auth/google/callback
```

---

# 16. GET `/auth/google/callback`

## Purpose

Handles the response from Google OAuth.

The callback obtains the authenticated Google profile and passes it to:

```typescript
authService.googleAuth(profile);
```

The service either:

- finds an existing user
- links Google authentication
- creates a new user

The callback then sets the refresh token cookie.

Current implementation redirects using:

```typescript
res.redirect(`${env.CLIENT_URL}/auth/success?token=${accessToken}`);
```

This behavior should be specifically reviewed during security testing because the access token is placed in the URL.

---

# 17. GET `/auth/github`

## Purpose

Starts GitHub OAuth authentication.

```http
GET {{baseUrl}}/auth/github
```

Passport handles the GitHub authorization flow.

---

# 18. GET `/auth/github/callback`

## Purpose

Handles GitHub OAuth callback.

The profile is passed to:

```typescript
authService.githubAuth(profile);
```

The service either:

- authenticates an existing account
- links GitHub authentication
- creates a new account

The refresh token is set as an HTTP-only cookie.

The access token is currently included in the frontend redirect URL.

---

# 19. Authentication Middleware

Protected APIs use:

```typescript
authenticate;
```

Example:

```typescript
router.put(
  "/update-password",
  authenticate,
  validate(updatePasswordSchema),
  authController.updatePassword,
);
```

The middleware should be tested independently using a protected endpoint.

## Test Cases

| Test                   | Expected                     |
| ---------------------- | ---------------------------- |
| Valid access token     | Request succeeds             |
| No token               | 401                          |
| Invalid token          | 401                          |
| Malformed token        | 401                          |
| Expired token          | 401                          |
| Token for deleted user | 401/expected behavior        |
| Banned/suspended user  | Expected account restriction |

---

# 20. Rate Limiting

Authentication endpoints use dedicated rate limiters.

### Registration

```typescript
registerLimiter;
```

### Login

```typescript
loginLimiter;
```

### Email Actions

```typescript
emailActionLimiter;
```

The following endpoints use `emailActionLimiter`:

```text
/auth/verify-email
/auth/forgot-password
/auth/reset-password
```

During testing we should record:

- Maximum attempts
- HTTP status after limit
- Error response
- Retry information
- Reset behavior

---

# 21. Authentication Testing Matrix

| ID       | Endpoint        | Scenario               | Expected | Actual | Status |
| -------- | --------------- | ---------------------- | -------- | ------ | ------ |
| AUTH-001 | Register        | Valid request          | 200      | —      | [x]     |
| AUTH-002 | Register        | Duplicate email        | 409      | —      | [x]     |
| AUTH-003 | Register        | Duplicate username     | 409      | —      | [x]     |
| AUTH-004 | Register        | Invalid input          | 400      | —      | [x]     |
| AUTH-005 | Verify Email    | Valid OTP              | 201      | —      | [x]     |
| AUTH-006 | Verify Email    | Invalid OTP            | 400      | —      | [x]     |
| AUTH-007 | Verify Email    | Expired OTP            | 400      | —      | [x]     |
| AUTH-008 | Verify Email    | Invalid input          | 400      | —      | [x]     |
| AUTH-009 | Login           | Valid credentials      | 200      | —      | [x]     |
| AUTH-010 | Login           | Wrong password         | 401      | —      | [x]     |
| AUTH-011 | Login           | Unknown user           | 401      | —      | [x]     |
| AUTH-012 | Login           | Invalid input          | 400      | —      | [x]     |
| AUTH-013 | Protected API   | Valid token            | 2xx      | —      | [x]     |
| AUTH-014 | Refresh         | Valid token            | 200      | —      | [x]     |
| AUTH-015 | Refresh         | Reused token           | 401      | —      | [x]     |
| AUTH-016 | Refresh         | Missing token          | 401      | —      | [x]     |
| AUTH-017 | Refresh         | Invalid token          | 401      | —      | [x]     |
| AUTH-018 | Logout          | Valid session          | 200      | —      | [x]     |
| AUTH-019 | Update Password | Valid request          | 200      | —      | [x]     |
| AUTH-020 | Update Password | Wrong current password | 401      | —      | [x]     |
| AUTH-021 | Update Password | Invalid input          | 400      | —      | [x]     |
| AUTH-022 | Update Password | No authentication      | 401      | —      | [x]     |
| AUTH-023 | Forgot Password | Existing user          | 200      | —      | [x]     |
| AUTH-024 | Forgot Password | Unknown email          | 200      | —      | [x]     |
| AUTH-025 | Forgot Password | No authentication      | 401      | —      | [x]     |
| AUTH-026 | Reset Password  | Valid token            | 200      | —      | [x]     |
| AUTH-027 | Reset Password  | Invalid token          | 400      | —      | [x]     |
| AUTH-028 | Reset Password  | Reused token           | 400      | —      | [x]     |
| AUTH-029 | Reset Password  | Invalid password       | 400      | —      | [x]     |
| AUTH-030 | Google          | OAuth flow             | Redirect | —      | [x]     |
| AUTH-031 | GitHub          | OAuth flow             | Redirect | —      | [x]     |
| AUTH-032 | Register        | Rate limit             | Limited  | —      | [x]     |
| AUTH-033 | Login           | Rate limit             | Limited  | —      | [x]     |
| AUTH-034 | Email Actions   | Rate limit             | Limited  | —      | [x]     |

---

# 22. Test Result Convention

Each completed test should eventually contain:

```markdown
### AUTH-001 — Register With Valid Data

**Status:** ✅ PASS

**Request**

...

**Expected Response**

...

**Actual Response**

...

**Database Result**

...

**Redis Result**

...

**Side Effects**

...

**Observations**

...

**Bug**

None
```

If something fails:

```markdown
**Status:** ❌ FAIL

**Bug:** BUG-AUTH-001

**Observed Behavior:**

...

**Expected Behavior:**

...

**Root Cause:**

...

**Fix:**

...

**Regression Test:**

...
```

This distinction will be extremely useful later when we start fixing the system.

---

# 23. Known Observations To Verify

At the time this document is initially created, the following are **observations from code inspection, not confirmed bugs**:

### Observation 1 — Forgot Password Requires Authentication

```text
POST /auth/forgot-password
        ↓
authenticate
```

We'll verify this behavior during Postman testing and decide whether it is intentional.

### Observation 2 — Password Validation Is Inconsistent

Registration/reset:

```text
8+
uppercase
lowercase
number
```

Update password:

```text
8+ only
```

We'll verify whether this is intentional.

### Observation 3 — OAuth Access Token In URL

Current callback redirects with:

```text
/auth/success?token=<accessToken>
```

We'll document and later evaluate whether this should be replaced with a safer authorization-code-style flow.

### Observation 4 — Refresh Token Can Be Sent In Body

The controller supports both:

```text
Cookie
```

and:

```json
{
  "refreshToken": "..."
}
```

We'll verify whether both paths are actually required.

---

# 24. Security Properties To Verify

The authentication module should be tested for:

- Password hashing
- Password never returned in API responses
- Generic invalid-login errors
- HttpOnly refresh cookies
- Refresh-token rotation
- Refresh-token revocation
- Password-reset token expiration
- Password-reset token single use
- OTP expiration
- OTP single use
- Account status restrictions
- Rate limiting
- Input validation
- OAuth state/security configuration
- Token leakage through URLs
- Session invalidation after password changes

---

# 25. Future Improvements

These should **not be implemented during the initial verification pass**.

They are documented here only as potential future work.

Possible areas include:

- Stronger password policy consistency
- Unauthenticated forgot-password flow, if product requirements allow it
- OAuth authorization-code flow instead of exposing access tokens in redirect URLs
- More explicit refresh-token/session management
- Device/session management
- Logout-all-devices
- Login attempt tracking
- Account lockout policies
- MFA/2FA
- Security audit logging
- Better OAuth failure handling
- Automated integration tests
- Postman collection automation

---

# 26. Authentication Module Testing Workflow

The actual verification process should follow this order:

```text
1. Register
      ↓
2. Verify OTP
      ↓
3. Login
      ↓
4. Test Access Token
      ↓
5. Refresh Token
      ↓
6. Test Refresh Token Rotation
      ↓
7. Logout
      ↓
8. Update Password
      ↓
9. Forgot Password
      ↓
10. Reset Password
      ↓
11. Verify Password Reset Revokes Sessions
      ↓
12. Google OAuth
      ↓
13. GitHub OAuth
      ↓
14. Rate Limiting
      ↓
15. Negative Testing
      ↓
16. Record Bugs
      ↓
17. Fix Bugs
      ↓
18. Regression Testing
```

---

# 27. Documentation Status

This document should be treated as a **living document during the testing phase**.

```text
API Documentation
        +
Implementation Reference
        +
Postman Test Cases
        +
Actual Test Results
        +
Bug Findings
        +
Final Verified Behavior
```

The important distinction is that **we should not mark expected behavior as verified until we actually run the Postman request**.

For example:

```text
Expected: 200
Actual: —
Status: ⬜ NOT TESTED
```

After testing:

```text
Expected: 200
Actual: 200
Status: ✅ PASS
```

If we discover something different:

```text
Expected: 200
Actual: 500
Status: ❌ FAIL
Bug: BUG-AUTH-001
```

That gives us a reliable historical record of how the Authentication module actually behaves.
