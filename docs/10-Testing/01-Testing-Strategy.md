# Testing Strategy

## 1. Overview

Testing is an important part of the WriteSpace development and documentation process.

The goal of testing is not only to verify that an API returns the expected HTTP response, but also to verify that the complete backend behavior is correct across:

- HTTP requests and responses
- Authentication and authorization
- Input validation
- Business logic
- PostgreSQL database state
- Redis state
- Cookies and tokens
- Events and asynchronous processing
- External services
- Error handling
- Rate limiting
- Security behavior
- Edge cases
- Failure scenarios
- Regression behavior

The testing strategy follows a progressive approach:

```text
Implementation
     ↓
API Documentation
     ↓
Test Planning
     ↓
Manual/API Testing
     ↓
Database/Redis Verification
     ↓
Bug Identification
     ↓
Fix
     ↓
Regression Testing
     ↓
Final Verification
```

The primary objective is to establish confidence in the current implementation before introducing additional features or architectural changes.

---

# 2. Testing Objectives

The main objectives of WriteSpace testing are:

1. Verify that every API behaves according to its documented contract.
2. Verify valid requests and expected successful behavior.
3. Verify invalid requests and expected error behavior.
4. Verify authentication and authorization boundaries.
5. Verify database state after important operations.
6. Verify Redis state for temporary and cached data.
7. Verify cookies and token behavior.
8. Verify asynchronous and event-driven side effects.
9. Verify rate limiting.
10. Identify bugs before making further architectural changes.
11. Prevent previously fixed bugs from returning.
12. Create a reliable testing record for future development and SDE interview preparation.

---

# 3. Testing Philosophy

WriteSpace follows a behavior-focused testing philosophy.

Testing should answer three questions:

### Question 1 — Does the API respond correctly?

Example:

```text
POST /api/v1/auth/login
        ↓
200 OK
```

### Question 2 — Did the system reach the correct internal state?

Example:

```text
Login
  ↓
Token generated
  ↓
Refresh token stored in Redis
```

### Question 3 — Did the expected side effects occur?

Example:

```text
Login
  ↓
Login alert email
  ↓
Authentication log
```

Therefore, an API should not be considered fully verified simply because it returns a successful HTTP status.

---

# 4. Testing Scope

Testing covers the major components of the WriteSpace backend.

```text
WriteSpace Backend
│
├── Authentication
├── Users
├── Posts
├── Interactions
├── Notifications
├── Middleware
├── Validation
├── Redis
├── Database
├── Events
├── Queues
├── Workers
├── External Services
└── Security
```

Each major module should have its own testing documentation.

---

# 5. Testing Levels

Testing is divided into multiple levels.

## 5.1 Unit Testing

Unit tests verify individual functions or isolated pieces of business logic.

Examples:

- Password validation
- Slug generation
- Domain utilities
- Permission checks
- Data transformations
- Helper functions

Unit testing should avoid unnecessary dependency on external systems.

---

## 5.2 Integration Testing

Integration tests verify that multiple components work correctly together.

Examples:

```text
Service
   ↓
Repository
   ↓
PostgreSQL
```

or:

```text
Authentication Service
   ↓
Redis
   ↓
Refresh Token
```

Integration tests are particularly important for functionality involving:

- PostgreSQL
- Redis
- Queues
- External services
- Events

---

## 5.3 API Testing

API testing verifies the externally visible behavior of HTTP endpoints.

Each API test should verify:

- HTTP method
- URL
- Headers
- Authentication
- Request body
- Query parameters
- Path parameters
- HTTP status
- Response body
- Cookies
- Error behavior

Postman is currently used for manual API testing.

---

## 5.4 Database Testing

Database verification confirms that API operations produce the correct persistent state.

Examples:

```text
Create User
    ↓
Verify User exists

Delete Post
    ↓
Verify Post no longer exists
```

Database testing should verify:

- Insertions
- Updates
- Deletions
- Relationships
- Constraints
- Unique fields
- Foreign keys
- Important indexes
- Transaction behavior where applicable

---

## 5.5 Redis Testing

Redis is used for temporary and high-speed application data.

Testing should verify:

- Key creation
- Key deletion
- TTL
- Value correctness
- Token rotation
- Expiration
- Single-use behavior
- Cache invalidation where applicable

Example:

```text
Registration
    ↓
auth:register:<email>
    ↓
TTL ≈ 60 seconds
```

---

## 5.6 End-to-End Testing

End-to-end testing verifies complete user workflows.

Example authentication workflow:

```text
Register
   ↓
Verify Email
   ↓
Login
   ↓
Access Protected API
   ↓
Refresh Token
   ↓
Logout
```

The purpose is to verify that individual APIs work together as a complete workflow.

---

# 6. API Testing Strategy

API testing follows a standard structure.

For every endpoint, verify:

```text
1. Endpoint accessibility
2. Authentication requirement
3. Authorization requirement
4. Request validation
5. Successful request
6. Invalid request
7. Missing fields
8. Invalid data types
9. Boundary values
10. Unauthorized access
11. Resource-not-found behavior
12. Duplicate/conflict behavior
13. Rate limiting
14. Database changes
15. Redis changes
16. Side effects
17. Error handling
```

Not every item applies to every endpoint.

---

# 7. Positive Testing

Positive testing verifies that valid requests produce the expected successful behavior.

Example:

```text
Valid Login
     ↓
Credentials accepted
     ↓
200 OK
     ↓
Access Token returned
     ↓
Refresh Cookie set
```

Positive tests should establish the normal working path before negative and edge-case testing begins.

---

# 8. Negative Testing

Negative testing verifies how the application behaves when invalid or unexpected input is supplied.

Examples:

```text
Invalid email
Missing password
Wrong password
Invalid token
Expired token
Non-existent resource
Duplicate resource
Unauthorized request
```

The purpose is to ensure that the application fails safely and predictably.

---

# 9. Boundary and Edge-Case Testing

Edge-case testing verifies behavior at the boundaries of the application's rules.

Examples:

### String boundaries

```text
Minimum allowed length
Below minimum length
Maximum allowed length
Above maximum length
Empty string
Whitespace-only string
```

### Numeric boundaries

```text
0
1
Maximum allowed value
Above maximum
Negative values
```

### Authentication boundaries

```text
Expired token
Already-used token
Missing token
Malformed token
Revoked token
```

### Pagination boundaries

```text
First page
Empty page
Last page
Invalid cursor
Very large limit
```

---

# 10. Authentication Testing

Authentication testing verifies:

- Registration
- Email verification
- Login
- Access-token validation
- Refresh-token rotation
- Logout
- Password reset
- Password update
- OAuth
- Account status restrictions

Authentication tests should verify both:

```text
HTTP behavior
```

and:

```text
Token / Cookie / Redis behavior
```

For example, successful refresh-token testing should verify:

```text
Old Refresh Token
        ↓
Consumed
        ↓
New Refresh Token
        ↓
Stored in Redis
```

---

# 11. Authorization Testing

Authentication and authorization are tested separately.

Authentication answers:

> Is the requester authenticated?

Authorization answers:

> Is the authenticated user allowed to perform this operation?

Tests should include:

```text
Unauthenticated user
Authenticated normal user
Resource owner
Non-owner
Admin
Restricted account
```

Where applicable, verify that users cannot access or modify resources belonging to other users.

---

# 12. Validation Testing

Validation testing verifies that invalid input is rejected before inappropriate business logic executes.

For each DTO/schema, test:

```text
Valid value
Missing value
Empty value
Wrong type
Minimum boundary
Maximum boundary
Invalid format
Unexpected value
```

Example:

```json
{
  "email": "not-an-email"
}
```

should be rejected by validation before reaching the main business operation.

---

# 13. Database Verification Strategy

Important API operations should be followed by database verification.

Example:

```text
POST /users
      ↓
HTTP Response
      ↓
Verify PostgreSQL
      ↓
Confirm expected record
```

Database verification should check:

- Correct record created
- Correct fields
- No unintended fields
- Correct relationships
- Correct status
- Correct timestamps
- Correct foreign keys
- No duplicate records

For destructive operations, verify that the intended record was removed or updated correctly.

---

# 14. Redis Verification Strategy

Redis should be verified whenever an API depends on Redis.

Examples include:

```text
OTP
Refresh Token
Password Reset Token
Cache
Rate Limiter
Temporary State
```

For each Redis operation verify:

```text
Key
Value
TTL
Creation
Expiration
Deletion
Rotation
```

Example:

```text
Register
   ↓
auth:register:<email>
   ↓
Verify key exists
   ↓
Verify OTP
   ↓
Verify TTL
   ↓
Verify key deleted after verification
```

---

# 15. Cookie Testing

Cookie-based authentication requires explicit verification.

Tests should verify:

- Cookie exists
- Cookie is cleared when expected
- `HttpOnly` behavior
- `Secure` behavior
- `SameSite` behavior
- Path
- Expiration/max-age
- Token rotation

For refresh-token authentication:

```text
Login
  ↓
Refresh Cookie Created
  ↓
Refresh
  ↓
Cookie Replaced
  ↓
Logout
  ↓
Cookie Cleared
```

---

# 16. Token Testing

Token testing should verify:

### Access Token

- Valid token
- Missing token
- Malformed token
- Expired token
- Invalid signature
- Wrong token type where applicable

### Refresh Token

- Valid token
- Expired token
- Invalid token
- Missing token
- Reused token
- Revoked token
- Token rotation

A particularly important security test is:

```text
Refresh Token A
      ↓
Refresh
      ↓
Token A invalid
      ↓
Token B valid
```

---

# 17. Rate-Limit Testing

Rate-limited endpoints should be tested by repeatedly sending requests until the configured threshold is reached.

Example:

```text
Request 1 → Allowed
Request 2 → Allowed
Request 3 → Allowed
...
Limit reached
...
Request N → 429 Too Many Requests
```

Testing should verify:

- Correct endpoint is limited
- Limit is enforced
- Correct status code
- Correct error response
- Limit resets as expected

Sensitive endpoints requiring special attention include:

- Login
- Registration
- OTP/email actions
- Password reset
- Other authentication-sensitive operations

---

# 18. Error Handling Testing

Every API should be tested for expected failure conditions.

Common categories:

```text
400 Bad Request
401 Unauthorized
403 Forbidden
404 Not Found
409 Conflict
422 Validation Error
429 Rate Limited
500 Internal Server Error
```

Tests should verify that errors:

- Return the correct status
- Return the expected response structure
- Do not expose sensitive information
- Do not leak database/internal implementation details
- Do not leave the system in an inconsistent state

---

# 19. Side-Effect Testing

Some API operations trigger additional actions.

Examples:

```text
Registration
    ↓
OTP Email

Login
    ↓
Login Alert

Password Reset
    ↓
Password Update Email

Interaction
    ↓
Event
    ↓
Notification
```

Whenever side effects are part of the API contract, they should be verified.

Side effects may include:

- Email
- Redis changes
- Database changes
- Events
- Queue jobs
- Notifications
- Media operations

---

# 20. Event-Driven Testing

WriteSpace contains event-driven infrastructure that can support future asynchronous functionality.

Event-producing operations should be tested for:

```text
Event generated
Event payload correct
Event published
Consumer receives event
Expected worker processes event
Failure behavior
Retry behavior
```

Example:

```text
Interaction
    ↓
Service
    ↓
Interaction Event
    ↓
Event System
    ↓
Consumer / Worker
```

The exact testing approach depends on whether the operation is synchronous or asynchronous.

---

# 21. External Service Testing

WriteSpace integrates with external services such as:

- Email service
- Cloudinary
- Google OAuth
- GitHub OAuth

Tests should verify:

### Successful external service

```text
Application
   ↓
External Service
   ↓
Success
```

### External service failure

```text
Application
   ↓
External Service
   ↓
Failure
   ↓
Application handles failure safely
```

External-service failures should not unnecessarily leave the application in an inconsistent state.

---

# 22. Failure Testing

Important infrastructure failures should eventually be tested.

Examples:

```text
PostgreSQL unavailable
Redis unavailable
Email service unavailable
Cloudinary unavailable
Queue unavailable
External OAuth provider unavailable
```

For each failure, determine:

1. Does the API fail?
2. What HTTP status is returned?
3. Is the error handled safely?
4. Is data partially written?
5. Is retry possible?
6. Is the failure logged?
7. Can the system recover?

---

# 23. Test Data Strategy

Test data should be controlled and reproducible.

Use dedicated test users and test resources.

Example:

```text
User A
Email: test-user-a@example.com

User B
Email: test-user-b@example.com
```

Test data should clearly identify:

- Owner
- Non-owner
- Admin
- Suspended user
- Banned user
- Verified user
- Unverified user

Avoid using production data for testing.

---

# 24. Test Dependencies

Some tests depend on the result of previous tests.

For example:

```text
Register
   ↓
Verify Email
   ↓
Login
   ↓
Access Token
   ↓
Protected API
```

Such dependencies should be explicitly documented.

However, individual tests should be made as independent as practical so that one failure does not make the entire test suite unusable.

---

# 25. Postman Testing Strategy

Postman is currently used as the primary manual API testing tool.

A Postman collection should eventually be organized by module:

```text
WriteSpace API
│
├── Authentication
├── Users
├── Posts
├── Interactions
└── Notifications
```

Within each collection, requests should follow logical workflows.

Example:

```text
Authentication
├── Registration
├── Email Verification
├── Login
├── Refresh Token
├── Logout
├── Password Management
└── OAuth
```

---

# 26. Environment Variables

Postman environments should be used instead of hardcoding environment-specific values.

Example:

```text
baseUrl
accessToken
refreshToken
userId
postId
commentId
```

Example request:

```text
{{baseUrl}}/auth/login
```

This makes it easier to switch between:

```text
Development
Testing
Production
```

without modifying every request.

---

# 27. Authentication State Management

Authentication tests require careful token management.

A typical state flow is:

```text
Register
   ↓
Verify
   ↓
Login
   ↓
Store accessToken
   ↓
Store refreshToken/cookie
   ↓
Use protected APIs
```

After token refresh:

```text
Old Access Token
      ↓
Refresh
      ↓
New Access Token
      ↓
Replace stored token
```

This prevents tests from accidentally using stale credentials.

---

# 28. Test Case Structure

Every test case should follow a consistent format.

```markdown
## TEST-ID — Test Name

**Status:** ⬜ NOT TESTED

### Objective

What is being verified?

### Preconditions

What must exist before the test?

### Request

Method, URL, headers, parameters, body.

### Expected Response

Expected HTTP status and response body.

### Expected Database State

Expected PostgreSQL changes.

### Expected Redis State

Expected Redis changes.

### Expected Side Effects

Expected emails, events, notifications, queues, etc.

### Actual Response

Observed result.

### Actual Database State

Observed database result.

### Actual Redis State

Observed Redis result.

### Actual Side Effects

Observed side effects.

### Result

PASS / FAIL / BLOCKED

### Observations

Additional findings.

### Bug

Related bug ID, if applicable.
```

---

# 29. Test Result Status

Use a consistent status system.

| Status         | Meaning                                                           |
| -------------- | ----------------------------------------------------------------- |
| ⬜ NOT TESTED  | Test has not been executed                                        |
| 🟡 BLOCKED     | Test cannot currently be executed                                 |
| 🟢 PASS        | Expected behavior confirmed                                       |
| 🔴 FAIL        | Actual behavior differs from expected                             |
| ⚠️ OBSERVATION | Behavior requires investigation but is not yet confirmed as a bug |

The distinction between **FAIL** and **OBSERVATION** is important.

Do not immediately classify unexpected behavior as a bug.

---

# 30. Bug Classification

When a test fails, record the problem separately.

Example:

```text
BUG-AUTH-001
BUG-POST-001
BUG-INTERACTION-001
```

A bug record should contain:

```text
Bug ID
Related Test
Module
Severity
Observed Behavior
Expected Behavior
Root Cause
Impact
Proposed Fix
Fix Status
Regression Test
```

---

# 31. Bug Severity

Use simple severity levels:

| Severity | Meaning                                     |
| -------- | ------------------------------------------- |
| Critical | System/security failure with major impact   |
| High     | Major functionality is broken               |
| Medium   | Important functionality behaves incorrectly |
| Low      | Minor issue or limited impact               |

Severity should describe the impact of the problem rather than how difficult it is to fix.

---

# 32. Regression Testing

After fixing a bug, the original test must be executed again.

Example:

```text
AUTH-PWD-009
      ↓
FAIL
      ↓
BUG-AUTH-001
      ↓
Fix
      ↓
AUTH-PWD-009
      ↓
PASS
```

Related tests should also be executed to ensure the fix did not introduce another problem.

For example, changing password validation should trigger regression testing for:

```text
Registration
Password Reset
Update Password
Login
```

where applicable.

---

# 33. Regression Strategy

Regression testing should happen after:

- Bug fixes
- Database schema changes
- Authentication changes
- Middleware changes
- API contract changes
- Redis changes
- Event-system changes
- Major architectural changes

Regression testing should prioritize functionality affected by the change.

---

# 34. API Contract Verification

The API documentation is considered the expected contract.

Testing compares:

```text
Documented Contract
        ↓
Actual Implementation
```

Possible results:

### Match

```text
Documentation = Implementation
→ PASS
```

### Implementation differs

```text
Documentation ≠ Implementation
→ Investigate
```

The difference may represent:

- Implementation bug
- Outdated documentation
- Intentional behavior not yet documented

Therefore, documentation should not be changed automatically when behavior differs.

---

# 35. Testing and Development Workflow

The recommended development workflow is:

```text
1. Implement Feature
        ↓
2. Document API Contract
        ↓
3. Create Test Cases
        ↓
4. Run Happy-Path Tests
        ↓
5. Run Negative Tests
        ↓
6. Verify Database / Redis
        ↓
7. Verify Side Effects
        ↓
8. Test Edge Cases
        ↓
9. Record Bugs / Observations
        ↓
10. Fix Confirmed Bugs
        ↓
11. Run Regression Tests
        ↓
12. Update Documentation
        ↓
13. Mark Feature Verified
```

---

# 36. Testing Order for WriteSpace

Testing should proceed in dependency order.

Recommended sequence:

```text
Authentication
      ↓
Users
      ↓
Posts
      ↓
Interactions
      ↓
Notifications
      ↓
Async/Event Infrastructure
      ↓
External Services
      ↓
Cross-Cutting Concerns
      ↓
Performance / Scalability
      ↓
Failure / Reliability
```

This order reduces dependency-related test failures.

For example, interaction testing depends on users and posts already functioning correctly.

---

# 37. Authentication Testing Order

Authentication should be tested in the following sequence:

```text
1. Registration
        ↓
2. Email Verification
        ↓
3. Login
        ↓
4. Protected API Authentication
        ↓
5. Refresh Token
        ↓
6. Logout
        ↓
7. Forgot Password
        ↓
8. Reset Password
        ↓
9. Update Password
        ↓
10. OAuth
        ↓
11. Rate Limiting
        ↓
12. Security Edge Cases
        ↓
13. Regression Testing
```

This follows the natural dependency chain of the authentication system.

---

# 38. Current Testing Approach

The current WriteSpace testing process is primarily manual API testing using Postman.

The initial focus is:

```text
API Verification
+
Database Verification
+
Redis Verification
+
Side-Effect Verification
```

Automated testing can be expanded later.

The goal of the current phase is to first establish confidence in the existing infrastructure and identify bugs before introducing further changes.

---

# 39. Future Automated Testing

Once the API behavior is stable, manual tests can gradually be converted into automated tests.

Potential future stack:

```text
Unit Tests
    ↓
Integration Tests
    ↓
API Tests
    ↓
End-to-End Tests
    ↓
CI Pipeline
```

Automated tests should focus especially on:

- Authentication
- Authorization
- Core business logic
- Database operations
- Token handling
- Interaction behavior
- Critical API contracts
- Previously discovered bugs

Every important bug fixed manually should ideally become an automated regression test later.

---

# 40. Definition of Done for an API

An API should not be considered fully verified until:

```text
☐ Happy path tested
☐ Validation tested
☐ Authentication tested
☐ Authorization tested where applicable
☐ Negative cases tested
☐ Edge cases tested
☐ Database state verified
☐ Redis state verified where applicable
☐ Cookies/tokens verified where applicable
☐ Side effects verified
☐ Rate limiting verified where applicable
☐ Error handling verified
☐ Security behavior reviewed
☐ Bugs documented
☐ Fixes regression-tested
☐ API documentation updated
```

Not every checkbox applies to every endpoint, but each applicable item should be considered before marking an API complete.

---

# 41. Definition of Done for a Module

A module can be considered verified when:

```text
All critical APIs tested
        ↓
Happy paths pass
        ↓
Important negative cases pass
        ↓
Database/Redis behavior verified
        ↓
Important side effects verified
        ↓
Security behavior reviewed
        ↓
Known bugs documented
        ↓
Critical bugs fixed
        ↓
Regression tests pass
        ↓
Documentation updated
```

---

# 42. Testing Documentation Structure

Testing documentation follows the same modular structure as the application.

```text
10-Testing/
│
├── 01-Testing-Strategy.md
│
├── 02-Authentication/
│   └── 01-Authentication-API-Testing.md
│
├── 03-Users/
│   └── 01-User-API-Testing.md
│
├── 04-Posts/
│   └── 01-Post-API-Testing.md
│
├── 05-Interactions/
│   └── 01-Interaction-API-Testing.md
│
├── 06-Edge-Cases.md
└── 07-Regression-Testing.md
```

The testing strategy is centralized here, while individual module testing documents contain the actual execution results.

---

# 43. Relationship With API Documentation

The API and testing documentation have different responsibilities.

```text
04-API-Design/
        │
        ▼
"What should the API do?"
        │
        ▼
10-Testing/
        │
        ▼
"Does the API actually do it?"
```

### API Documentation

Contains:

- Endpoint contract
- Request
- Response
- Validation
- Authentication
- Internal flow
- Database/Redis interaction
- Design decisions

### Testing Documentation

Contains:

- Test case
- Preconditions
- Request
- Expected result
- Actual result
- Database verification
- Redis verification
- Side effects
- PASS/FAIL
- Bugs
- Regression results

This separation prevents duplication and keeps both documents maintainable.

---

# 44. Final Testing Principle

The primary principle of WriteSpace testing is:

> **Do not test only whether the API responds correctly. Test whether the entire system reaches the correct state and produces the expected side effects.**

For example:

```text
HTTP Response
      +
Database State
      +
Redis State
      +
Cookies / Tokens
      +
Events
      +
External Side Effects
      =
Verified API Behavior
```

This approach provides stronger confidence in the backend and creates a reliable foundation for future development, debugging, refactoring, and SDE interview discussions.
