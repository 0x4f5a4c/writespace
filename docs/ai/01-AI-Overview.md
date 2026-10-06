# WriteSpace AI — Overview

## 1. Purpose

WriteSpace is a social blogging platform where users can create and share technical content.

The AI layer was introduced to improve the content creation and discovery experience while keeping the existing WriteSpace architecture intact.

The initial AI implementation is intentionally small. Instead of immediately building a complete recommendation or AI-driven feed system, the project starts with a small set of practical AI capabilities that can be integrated into the existing backend without introducing unnecessary complexity.

The current AI implementation focuses on:

1. **AI Post Assistant**
2. Preparing the architecture for future AI capabilities such as semantic search

The AI system is designed so that future AI features can be added without tightly coupling the application to a specific AI provider.

---

# 2. Why AI Was Introduced

The original WriteSpace backend already provides the core functionality required for users to create and interact with blog posts.

However, AI can provide additional value in two major areas:

### Content Creation

Users may need help with:

- creating a better title
- summarizing a post
- identifying relevant technical topics
- improving the presentation of their content

The first AI feature therefore focuses on assisting users while they are creating a post.

### Content Discovery

As the number of posts increases, traditional keyword-based search may become insufficient.

For example, a user might search for:

> "How can I improve backend performance?"

while the relevant post may never contain those exact words.

This creates an opportunity for semantic search using embeddings and vector similarity.

Semantic search is planned for a later stage and is **not part of the current implementation**.

---

# 3. Current AI Scope

The current AI implementation contains one user-facing feature:

## AI Post Assistant

The Post Assistant accepts information about a technical blog post and generates:

- a suggested title
- a summary
- relevant technical topics

Example request:

```json
{
  "title": "Understanding Redis Caching",
  "content": "Redis is an in-memory data store commonly used for caching frequently accessed data. It can improve application performance by reducing repeated database queries.",
  "instruction": "Make the suggestions suitable for backend developers."
}
```

Example response:

```json
{
  "status": "success",
  "data": {
    "suggestedTitle": "Mastering Redis Caching for Backend Performance",
    "summary": "An introduction to Redis as an in-memory data store, focusing on how backend developers can leverage caching to minimize database load and accelerate application response times.",
    "topics": [
      "Redis",
      "Caching",
      "Backend Development",
      "Database Optimization",
      "Performance Tuning"
    ]
  }
}
```

The generated suggestions are returned to the client and are **not currently persisted as AI-generated data in the database**.

---

# 4. Current Architecture

The AI implementation follows the existing modular backend architecture of WriteSpace.

At a high level, the current request flow is:

```text
Client
  │
  │ POST /api/v1/ai/post-assistant
  ▼
AI Controller
  │
  ▼
AI Service
  │
  ▼
Text Generation Service
  │
  ▼
AI Provider
  │
  ▼
Gemini Provider
  │
  ▼
Google Gemini API
```

The response travels back through the same layers:

```text
Google Gemini API
      │
      ▼
Gemini Provider
      │
      ▼
Text Generation Service
      │
      ▼
AI Service
      │
      ▼
AI Controller
      │
      ▼
Client
```

Each layer has a specific responsibility.

### AI Controller

Responsible for:

- receiving the HTTP request
- validating the request using the feature DTO schema
- calling the AI service
- returning the HTTP response

### AI Service

Responsible for:

- implementing the Post Assistant use case
- constructing the AI prompt
- defining the expected structured response
- parsing the AI response
- validating the generated response

### Text Generation Service

Responsible for common AI execution concerns such as:

- checking whether AI is enabled
- invoking the configured provider
- timeout handling
- request cancellation
- retry handling
- exponential backoff
- logging
- normalizing provider failures

### AI Provider

Defines the abstraction between WriteSpace and an external AI provider.

The application does not directly depend on Gemini-specific implementation details at the service layer.

---

# 5. AI Provider

The initial provider selected for WriteSpace is **Google Gemini**.

The application uses the Gemini JavaScript SDK through the provider implementation.

The current provider configuration is:

```env
AI_PROVIDER=gemini
AI_MODEL=gemini-3.5-flash-lite
```

The provider layer also contains a mock implementation used for automated testing.

This gives the application two provider implementations:

```text
AIProvider
   ├── GeminiProvider
   └── MockAIProvider
```

The purpose of this abstraction is to prevent the application layer from becoming tightly coupled to Gemini.

For example, the `AIService` does not need to know how Gemini's SDK works.

It only needs to communicate with the text-generation service.

---

# 6. Why Provider Abstraction Exists

The AI provider is treated as an external dependency.

If the application directly called the Gemini SDK from the feature service, the feature would become tightly coupled to Gemini.

For example, this would create unnecessary coupling:

```text
AIService
    │
    └── GoogleGenAI SDK
```

Instead, the current architecture separates the application from the provider:

```text
AIService
    │
    ▼
TextGenerationService
    │
    ▼
AIProvider
    │
    ├── GeminiProvider
    └── MockAIProvider
```

This provides several benefits:

- provider-specific code remains isolated
- providers can be replaced later
- automated tests do not require real AI API calls
- business logic does not depend on a specific SDK
- provider-specific failures can be handled in one place

The detailed implementation of this abstraction is documented in:

`05-AI-Provider-Layer.md`

---

# 7. AI Configuration

AI behavior is controlled through environment variables.

The current configuration includes:

```env
AI_ENABLED=true
AI_PROVIDER=gemini
AI_MODEL=gemini-3.5-flash-lite
AI_TIMEOUT_MS=60000
AI_MAX_INPUT_CHARS=12000
AI_MAX_OUTPUT_TOKENS=1000
AI_MAX_RETRIES=2
```

These values are validated through the existing environment configuration using Zod.

The configuration provides control over:

- whether AI functionality is enabled
- which provider is used
- which model is selected
- request timeout
- maximum input size
- maximum generated output
- maximum retry attempts

The API key is also loaded through environment configuration and is not hardcoded into the application.

Detailed configuration is documented in:

`04-AI-Configuration.md`

> **Note:** The `60s` timeout is currently retained while the AI integration is being tested. It should be evaluated and tuned based on observed production behavior before treating it as the final value.

---

# 8. AI Feature Flag

AI functionality can be disabled through:

```env
AI_ENABLED=false
```

The `TextGenerationService` checks this configuration before making an AI request.

Conceptually:

```ts
if (!env.AI_ENABLED) {
  throw new AIDisabledError();
}
```

This provides a simple operational kill switch.

For example, if the external AI provider becomes unavailable or AI functionality needs to be temporarily disabled, the application does not need to remove or modify the AI feature itself.

---

# 9. Input Validation

The Post Assistant request is validated before reaching the AI provider.

The current request schema validates:

- optional title
- required content
- optional instruction
- maximum input sizes

The content is limited using:

```ts
.max(
  env.AI_MAX_INPUT_CHARS,
  `Content cannot exceed ${env.AI_MAX_INPUT_CHARS} characters`,
)
```

The purpose is to prevent unnecessarily large requests from reaching the AI provider.

This also provides protection against:

- accidental oversized requests
- unnecessary token consumption
- excessive latency
- uncontrolled AI usage

The detailed validation implementation is documented with the Post Assistant feature.

---

# 10. Structured AI Responses

The Post Assistant does not simply return arbitrary text from the AI model.

The application asks the model to return a specific JSON structure:

```json
{
  "suggestedTitle": "string",
  "summary": "string",
  "topics": ["string"]
}
```

After receiving the response:

1. the raw response is parsed as JSON
2. the parsed object is validated using Zod
3. invalid responses are rejected

This creates an important boundary between:

```text
Untrusted AI Output
        ↓
JSON Parsing
        ↓
Schema Validation
        ↓
Trusted Application Data
```

The application therefore does not blindly trust the AI model's output.

---

# 11. Timeout and Request Cancellation

AI requests are external network operations and can take an unpredictable amount of time.

The current implementation uses `AbortController` to cancel the provider request when the configured timeout is reached.

The flow is:

```text
AI Request
    │
    ├── Provider request
    │
    └── Timeout timer
             │
             ▼
       AbortController
             │
             ▼
       Cancel request
             │
             ▼
       AITimeoutError
```

This is important because a timeout should not leave an external provider request running indefinitely while the application has already given up waiting.

The timeout and cancellation implementation is documented in:

`09-AI-Reliability.md`

---

# 12. Retry Handling

Transient provider failures can occur even when the application itself is functioning correctly.

The current implementation retries selected transient failures.

Retryable HTTP status codes include:

```text
408
429
5xx
```

The current retry configuration is:

```env
AI_MAX_RETRIES=2
```

Retries use exponential backoff:

```text
Attempt 1
    ↓
wait 1 second

Attempt 2
    ↓
wait 2 seconds
```

Timeout errors are intentionally **not retried**.

This distinction is important because retrying an already timed-out request could unnecessarily increase latency and provider usage.

---

# 13. Real Provider Failure During Development

During development, the initial Gemini model produced:

```text
HTTP 503
UNAVAILABLE

"This model is currently experiencing high demand."
```

The important part of the debugging process was that the failure was reproduced outside WriteSpace using the Gemini SDK directly.

The direct test initially failed with the same model.

After switching the direct test to:

```text
gemini-3.5-flash-lite
```

the request succeeded:

```text
Testing Gemini directly...
SUCCESS
HELLO
```

The same model was then configured in WriteSpace, and the actual Post Assistant endpoint successfully generated structured output.

This established that the earlier problem was not caused by:

- the WriteSpace controller
- the AI service
- the provider abstraction
- the API key configuration
- the Gemini SDK integration itself

The issue was associated with the availability/capacity of the initially selected model.

This debugging experience is documented separately in:

`decisions/01-Gemini-as-Initial-Provider.md`

---

# 14. Testing Strategy

The AI implementation includes a mock provider so automated tests do not need to communicate with the real Gemini API.

The architecture is:

```text
Production

AIService
    ↓
TextGenerationService
    ↓
GeminiProvider
    ↓
Gemini API
```

while tests can use:

```text
AIService
    ↓
TextGenerationService
    ↓
MockAIProvider
```

This allows the application logic to be tested without:

- consuming AI API quota
- requiring an internet connection
- depending on model output variability
- making tests slow or flaky

The current AI service tests cover:

- valid JSON response
- invalid JSON response
- valid JSON with an invalid response schema
- propagation of TextGenerationService errors

The TextGenerationService tests additionally cover:

- successful generation
- AI disabled
- unexpected provider error
- timeout
- retry on transient provider failure
- no retry on non-transient failure

Detailed testing information is documented in:

`10-AI-Testing.md`

---

# 15. Database Strategy

The current AI Post Assistant does **not introduce any new database tables or columns**.

The feature operates on the request and returns generated suggestions directly.

Conceptually:

```text
Client
  │
  ▼
AI Post Assistant
  │
  ▼
Gemini
  │
  ▼
Generated Suggestions
  │
  ▼
Client
```

There is currently no:

- AI usage table
- AI request history table
- AI response table
- prompt table
- AI-generated content table

This was intentional.

The first AI feature does not require persistence, so introducing AI-specific database structures at this stage would add complexity without providing immediate value.

Future features such as semantic search will have different persistence requirements.

---

# 16. Current AI Folder Structure

The current AI implementation follows the modular structure of WriteSpace.

The relevant structure is:

```text
src/
├── modules/
│   └── ai/
│       ├── controllers/
│       │   └── ai.controller.ts
│       ├── dto/
│       │   └── post-assistant.dto.ts
│       ├── services/
│       │   └── ai.service.ts
│       └── ai.routes.ts
│
└── shared/
    └── ai/
        ├── errors/
        │   └── ai.errors.ts
        ├── providers/
        │   ├── ai.provider.ts
        │   ├── gemini.provider.ts
        │   ├── mock.provider.ts
        │   └── ai-provider.factory.ts
        └── services/
            └── text-generation.service.ts
```

The distinction is intentional:

### `modules/ai`

Contains WriteSpace-specific AI features.

For example:

```text
AI Post Assistant
```

### `shared/ai`

Contains reusable AI infrastructure.

For example:

```text
AI Provider
Text Generation Service
Gemini Provider
Mock Provider
AI Errors
```

This separation allows future AI features to reuse the infrastructure without duplicating provider logic.

---

# 17. Current API

The current AI endpoint is:

```http
POST /api/v1/ai/post-assistant
```

Request:

```json
{
  "title": "Understanding Redis Caching",
  "content": "Redis is an in-memory data store...",
  "instruction": "Make the suggestions suitable for backend developers."
}
```

Successful response:

```json
{
  "status": "success",
  "data": {
    "suggestedTitle": "...",
    "summary": "...",
    "topics": ["...", "...", "..."]
  }
}
```

The endpoint is synchronous because the user explicitly requests the AI assistance and expects the suggestions as part of the same interaction.

---

# 18. What Is Not Implemented Yet

The following capabilities are **planned but not currently implemented**:

- semantic search
- embeddings
- vector database/index
- related-post recommendations
- user interest profiles
- personalized feed
- recommendation ranking
- trending topics
- AI-based moderation
- AI-powered notification ranking
- personalized digest
- separate AI microservice

These features are intentionally deferred.

The current goal is to establish a reliable AI foundation and deliver a small useful AI feature before increasing system complexity.

---

# 19. Future AI Direction

The long-term AI roadmap for WriteSpace can be viewed as:

```text
AI Foundation
      │
      ▼
Post Understanding
(summary / topics / metadata)
      │
      ▼
Embeddings
      │
      ▼
Semantic Search
      │
      ▼
Related Posts
      │
      ▼
User Interest Profile
      │
      ▼
Candidate Generation
      │
      ▼
Ranking
      │
      ▼
Personalized Feed
```

Other future capabilities can build on the same foundation:

```text
                    ┌── Semantic Search
                    │
AI Foundation ──────┼── Related Posts
                    │
                    ├── Personalized Feed
                    │
                    ├── Moderation
                    │
                    ├── Writing Assistant
                    │
                    └── Notification/Digest Ranking
```

The architecture is therefore designed to allow the AI layer to grow without requiring the entire backend to be redesigned.

---

# 20. Current Implementation Status

| Component                      | Status             |
| ------------------------------ | ------------------ |
| AI configuration               | ✅ Implemented     |
| AI feature flag                | ✅ Implemented     |
| Provider abstraction           | ✅ Implemented     |
| Gemini provider                | ✅ Implemented     |
| Mock provider                  | ✅ Implemented     |
| Provider factory               | ✅ Implemented     |
| Timeout handling               | ✅ Implemented     |
| AbortController cancellation   | ✅ Implemented     |
| Retry handling                 | ✅ Implemented     |
| Exponential backoff            | ✅ Implemented     |
| AI-specific errors             | ✅ Implemented     |
| Input validation               | ✅ Implemented     |
| Structured response validation | ✅ Implemented     |
| AI Post Assistant API          | ✅ Implemented     |
| Automated unit tests           | ✅ Implemented     |
| AI database persistence        | ❌ Not implemented |
| Embeddings                     | ❌ Not implemented |
| Semantic search                | ❌ Not implemented |
| Personalized recommendations   | ❌ Not implemented |

---

# 21. Key Engineering Principles

The current AI implementation follows several principles:

### 1. Keep AI behind an abstraction

Application code should not depend directly on a provider SDK.

### 2. Treat AI output as untrusted input

Generated responses are parsed and schema-validated before being returned by the application.

### 3. Fail gracefully

Provider failures are converted into application-level errors instead of exposing provider-specific behavior to the rest of the application.

### 4. Control external dependency behavior

Timeouts, cancellation, retries and backoff prevent external AI calls from becoming uncontrolled application operations.

### 5. Test without real AI calls

The mock provider allows deterministic automated testing without consuming provider quota.

### 6. Avoid premature infrastructure

The MVP does not introduce AI-specific database structures, microservices, vector infrastructure or recommendation systems before they are required.

### 7. Keep the architecture extensible

The current implementation is intentionally small, but the provider and service boundaries allow additional AI capabilities to be introduced later.

---

# 22. Related Documentation

The detailed AI documentation is organized as follows:

```text
01-AI-Overview.md
    ↓
02-AI-Architecture.md
    ↓
03-AI-Provider-Selection.md
    ↓
04-AI-Configuration.md
    ↓
05-AI-Provider-Layer.md
    ↓
06-AI-Service-Layer.md
    ↓
07-AI-Request-Lifecycle.md
    ↓
08-AI-Error-Handling.md
    ↓
09-AI-Reliability.md
    ↓
10-AI-Testing.md
    ↓
features/
    └── 01-AI-Post-Assistant.md
    ↓
decisions/
    ├── 01-Gemini-as-Initial-Provider.md
    ├── 02-Provider-Abstraction.md
    ├── 03-No-AI-Database-in-MVP.md
    └── 04-Sync-vs-Async-AI.md
```

Each subsequent document goes deeper into the implementation without duplicating the complete overview.
