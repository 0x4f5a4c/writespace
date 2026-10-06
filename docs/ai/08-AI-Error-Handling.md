# AI Error Handling

## 1. Purpose

AI provider calls are different from normal application operations because they depend on an external service.

For WriteSpace, an AI request can fail for several reasons:

- AI functionality may be disabled.
- The external AI provider may be temporarily unavailable.
- The provider may return a transient error such as `429` or `5xx`.
- The provider may take too long to respond.
- The provider may return malformed or unexpected content.
- The AI may return valid JSON syntax but an incorrect response structure.
- An unexpected application or provider error may occur.

The AI integration therefore separates different failure conditions into explicit application errors and handles transient failures through controlled retries.

The goal is to prevent provider-specific failures from leaking directly into the rest of the application while giving the API layer predictable errors.

---

# 2. Error-Handling Architecture

The AI error flow can be represented as:

```text
Client
  |
  v
AI Controller
  |
  | Request validation
  |----------------------> 400 Bad Request
  |
  v
AI Service
  |
  | Prompt generation
  v
TextGenerationService
  |
  | AI enabled?
  |----------------------> AIDisabledError
  |
  | Provider request
  v
AI Provider
  |
  +---- Timeout ---------> AITimeoutError
  |
  +---- 408/429/5xx -----> Retry
  |                           |
  |                           +---- succeeds
  |                           |
  |                           +---- retries exhausted
  |                                      |
  |                                      v
  |                               AIProviderError
  |
  +---- Other error -------> AIProviderError
  |
  v
AI Service
  |
  | Parse AI response
  |----------------------> AIResponseParseError
  |
  | Validate response schema
  |----------------------> AIResponseParseError
  |
  v
Controller
  |
  v
Global Express Error Handler
  |
  v
HTTP Response
```

The important design principle is that each layer handles the failures that belong to its responsibility.

---

# 3. AI Error Classes

WriteSpace defines dedicated error classes for AI-related failures.

The current implementation contains:

```ts
export class AIDisabledError extends AppError {
  constructor() {
    super(
      HTTP_STATUS.SERVICE_UNAVAILABLE,
      "AI features are currently disabled",
    );
  }
}

export class AIProviderError extends AppError {
  constructor(message = "AI provider request failed") {
    super(HTTP_STATUS.BAD_GATEWAY, message);
  }
}

export class AITimeoutError extends AppError {
  constructor() {
    super(HTTP_STATUS.GATEWAY_TIMEOUT, "AI provider request timed out");
  }
}

export class AIValidationError extends AppError {
  constructor(message: string) {
    super(HTTP_STATUS.BAD_REQUEST, message);
  }
}

export class AIResponseParseError extends AppError {
  constructor() {
    super(HTTP_STATUS.BAD_GATEWAY, "AI provider returned an invalid response");
  }
}
```

All of these extend the application's existing `AppError`.

This allows AI-specific failures to use the same error-handling infrastructure as the rest of the application.

---

# 4. Relationship With `AppError`

The base application error is:

```ts
export class AppError extends Error {
  public statusCode: number;
  public status: string;
  public isOperational: boolean;

  constructor(statusCode: number, message: string) {
    super(message);

    this.statusCode = statusCode;

    this.status = `${statusCode}`.startsWith("4") ? "fail" : "error";

    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}
```

The AI errors reuse this abstraction rather than creating a completely separate error system.

This gives AI errors:

- an HTTP status code,
- a status classification,
- an operational-error marker,
- a standard JavaScript `Error` stack,
- compatibility with the application's global error handler.

For example:

```ts
export class AITimeoutError extends AppError {
  constructor() {
    super(HTTP_STATUS.GATEWAY_TIMEOUT, "AI provider request timed out");
  }
}
```

The AI-specific class therefore describes the failure while `AppError` provides the common application-level behavior.

---

# 5. Error Classification

The current AI errors can be grouped into several categories.

| Error                  | Meaning                                                           | HTTP Status | Current Usage                                |
| ---------------------- | ----------------------------------------------------------------- | ----------: | -------------------------------------------- |
| `AIDisabledError`      | AI functionality is disabled through configuration                |         503 | Used                                         |
| `AIProviderError`      | AI provider request failed unexpectedly or retries were exhausted |         502 | Used                                         |
| `AITimeoutError`       | Provider did not respond within configured timeout                |         504 | Used                                         |
| `AIValidationError`    | Dedicated AI validation error abstraction                         |         400 | Defined but not currently used in shown flow |
| `AIResponseParseError` | Provider response cannot be parsed/validated                      |         502 | Used                                         |

The distinction between these errors is important because not every failure should be treated the same way.

---

# 6. AI Disabled Error

AI can be disabled through configuration.

The `TextGenerationService` checks the feature flag before making any provider request:

```ts
if (!env.AI_ENABLED) {
  throw new AIDisabledError();
}
```

This means that when:

```env
AI_ENABLED=false
```

the application does not attempt to contact Gemini.

Instead, the request immediately fails with:

```ts
AIDisabledError;
```

which maps to:

```text
503 Service Unavailable
```

### Why this is useful

The application can disable AI without removing the AI routes or changing the business logic.

For example:

```text
Request
   |
   v
TextGenerationService
   |
   +---- AI_ENABLED = false
             |
             v
      AIDisabledError
             |
             v
          503
```

This is particularly useful when:

- the AI provider is temporarily unavailable,
- development does not require AI,
- API usage needs to be disabled,
- the application wants to operate without AI functionality.

---

# 7. Provider Errors

The AI provider is an external dependency.

The `TextGenerationService` therefore does not expose arbitrary provider failures directly to the rest of the application.

The main provider-level error is:

```ts
export class AIProviderError extends AppError {
  constructor(message = "AI provider request failed") {
    super(HTTP_STATUS.BAD_GATEWAY, message);
  }
}
```

It maps to:

```text
502 Bad Gateway
```

This represents the situation where WriteSpace is functioning as an API server, but its upstream AI dependency failed.

---

# 8. Unexpected Provider Errors

The service catches unexpected errors:

```ts
try {
  const response = await this.generateWithRetry(request);

  // ...
  return response;
} catch (error) {
  // ...
}
```

Known errors are handled separately.

For example:

```ts
if (error instanceof AITimeoutError) {
  // timeout handling
}

if (error instanceof AIProviderError) {
  // provider error handling
}
```

Anything unexpected is normalized:

```ts
throw new AIProviderError();
```

This prevents arbitrary provider/library errors from becoming part of the application's API contract.

Instead of exposing something provider-specific, the application exposes:

```text
AI provider request failed
```

---

# 9. Timeout Handling

AI requests are external network operations and therefore require a timeout.

WriteSpace uses:

```env
AI_TIMEOUT_MS=60000
```

The `TextGenerationService` creates an `AbortController`:

```ts
const controller = new AbortController();

const timeout = setTimeout(() => {
  controller.abort();
}, env.AI_TIMEOUT_MS);
```

The signal is passed to the provider:

```ts
return await this.provider.generateText({
  ...request,
  signal: controller.signal,
});
```

The Gemini provider passes that signal to the SDK:

```ts
const response = await this.client.models.generateContent({
  model: env.AI_MODEL,
  contents: request.prompt,
  config: {
    systemInstruction: request.systemInstruction,
    maxOutputTokens: request.maxOutputTokens ?? env.AI_MAX_OUTPUT_TOKENS,
    abortSignal: request.signal,
    thinkingConfig: {
      thinkingLevel: "low",
    },
  },
});
```

If the controller aborts the request:

```ts
if (controller.signal.aborted) {
  throw new AITimeoutError();
}
```

The error therefore becomes:

```text
AITimeoutError
        |
        v
504 Gateway Timeout
```

---

# 10. Why Timeout Is Not Retried

The current implementation intentionally does not retry timeouts.

Inside `generateWithRetry()`:

```ts
if (error instanceof AITimeoutError) {
  throw error;
}
```

This means:

```text
Provider timeout
      |
      v
AITimeoutError
      |
      v
Immediately propagate
```

The timeout is not treated as a transient provider status.

This prevents a slow provider request from automatically turning into several additional slow requests.

For the current synchronous Post Assistant feature, keeping timeout behavior predictable is more important than aggressively retrying it.

---

# 11. Retryable Errors

Some provider failures may be temporary.

The current implementation considers these statuses retryable:

```ts
if ([408, 429].includes(status)) {
  return true;
}

if (status >= 500 && status <= 599) {
  return true;
}
```

Therefore, the current retry policy includes:

### `408`

Request Timeout.

### `429`

Too Many Requests / rate limiting.

### `5xx`

Server-side errors from the provider.

The retry policy is intentionally status-based.

---

# 12. Non-Retryable Errors

Errors outside the retryable categories are not retried.

For example:

```text
400
401
403
404
other non-5xx errors
```

are not considered transient by the current implementation.

The reasoning is that repeatedly sending the same request is unlikely to fix a deterministic client/configuration/authentication problem.

The flow is:

```text
Provider Error
     |
     v
Is status retryable?
     |
   No
     |
     v
Propagate error
     |
     v
AIProviderError / global handling
```

---

# 13. Retry Limit

The maximum number of retries is configuration-driven:

```env
AI_MAX_RETRIES=2
```

The service checks:

```ts
if (attempt >= env.AI_MAX_RETRIES) {
  throw error;
}
```

This prevents an AI request from retrying indefinitely.

With:

```env
AI_MAX_RETRIES=2
```

the behavior is approximately:

```text
Initial attempt
      |
      X transient failure
      |
      v
Retry #1
      |
      X transient failure
      |
      v
Retry #2
      |
      X transient failure
      |
      v
Stop
```

The exact number of provider calls is therefore the initial attempt plus the configured retries.

---

# 14. Exponential Backoff

The retry delay is calculated using:

```ts
private calculateBackoffDelay(attempt: number): number {
  return 1000 * 2 ** (attempt - 1);
}
```

This produces:

| Retry Attempt |    Delay |
| ------------: | -------: |
|             1 |  1000 ms |
|             2 |  2000 ms |
|             3 |  4000 ms |
|             4 |  8000 ms |
|             5 | 16000 ms |

The current configuration allows at most two retries:

```env
AI_MAX_RETRIES=2
```

so the normal configured delays are:

```text
1 second
2 seconds
```

The service logs the retry:

```ts
logger.warn(
  `[AI] Transient provider error. Retrying attempt ${attempt}/${env.AI_MAX_RETRIES} after ${delay}ms`,
);
```

---

# 15. Retry Flow

The complete retry behavior is:

```text
generate()
   |
   v
generateWithRetry()
   |
   v
generateWithTimeout()
   |
   v
Provider
   |
   +---- Success ----------------------> Return response
   |
   +---- Timeout ----------------------> AITimeoutError
   |
   +---- 408/429/5xx
   |          |
   |          v
   |     Retry available?
   |       /       \
   |     Yes        No
   |      |          |
   |      v          v
   |   Backoff    Propagate
   |      |
   |      v
   |   Retry
   |
   +---- Other error ------------------> Propagate
```

This keeps retry logic inside the shared `TextGenerationService` instead of duplicating it inside individual AI features.

---

# 16. Response Parsing Errors

A successful provider HTTP response does not necessarily mean that the AI response is usable.

The Post Assistant asks the model to return JSON:

```json
{
  "suggestedTitle": "string",
  "summary": "string",
  "topics": ["string"]
}
```

The AI service first attempts to parse the returned text:

```ts
private parseAIResponse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    logger.error("[AI] Post assistant returned invalid JSON");
    throw new AIResponseParseError();
  }
}
```

If the provider returns something such as:

```text
Here is your result:

{
  ...
}
```

the response may no longer be valid JSON for the expected parser.

The service therefore throws:

```ts
AIResponseParseError;
```

which maps to:

```text
502 Bad Gateway
```

---

# 17. Schema Validation Errors

Valid JSON is not enough.

For example, the AI could return:

```json
{
  "title": "Redis Caching"
}
```

This is valid JSON, but it does not satisfy the expected Post Assistant response.

WriteSpace validates the parsed response using Zod:

```ts
const validatedResponse = postAssistantResponseSchema.safeParse(parsedResponse);
```

The expected schema is:

```ts
export const postAssistantResponseSchema = z.object({
  suggestedTitle: z.string().min(1),
  summary: z.string().min(1),
  topics: z.array(z.string()).min(1),
});
```

If validation fails:

```ts
if (!validatedResponse.success) {
  logger.error(
    `[AI] Post assistant returned invalid structured data: ${validatedResponse.error.message}`,
  );

  throw new AIResponseParseError();
}
```

Therefore:

```text
Valid JSON
    |
    v
Zod schema validation
    |
    +---- Valid ------> Return structured result
    |
    +---- Invalid ----> AIResponseParseError
```

This provides a second layer of protection after JSON parsing.

---

# 18. Why Parse and Schema Validation Are Both Necessary

These are two different failure cases.

### Case 1: Invalid JSON

```text
This is not JSON
```

`JSON.parse()` fails.

### Case 2: Valid JSON, wrong structure

```json
{
  "title": "Redis"
}
```

`JSON.parse()` succeeds, but the Zod schema fails.

Therefore the validation pipeline is:

```text
AI text
  |
  v
JSON.parse()
  |
  +---- invalid JSON ----> AIResponseParseError
  |
  v
Parsed object
  |
  v
Zod validation
  |
  +---- invalid schema -> AIResponseParseError
  |
  v
Validated response
```

This is especially important because AI output is probabilistic and should not be trusted merely because the provider returned HTTP success.

---

# 19. Request Validation vs AI Validation

The current implementation validates incoming requests before invoking the AI service.

The controller uses:

```ts
const validatedRequest = postAssistantRequestSchema.safeParse(req.body);
```

If validation fails:

```ts
res.status(HTTP_STATUS.BAD_REQUEST).json({
  status: "fail",
  message: "Invalid post assistant request",
  errors: validatedRequest.error.flatten(),
});

return;
```

This means invalid user input is rejected before an AI call occurs.

For example:

- missing `content`,
- content exceeding `AI_MAX_INPUT_CHARS`,
- title exceeding 300 characters,
- instruction exceeding 1000 characters.

These currently produce a `400 Bad Request` directly from the controller.

---

# 20. `AIValidationError`

The codebase contains:

```ts
export class AIValidationError extends AppError {
  constructor(message: string) {
    super(HTTP_STATUS.BAD_REQUEST, message);
  }
}
```

However, the current Post Assistant request flow does **not** use this class.

Instead, request validation is performed directly through the controller's Zod schema:

```ts
const validatedRequest = postAssistantRequestSchema.safeParse(req.body);
```

Therefore, the documentation should distinguish between:

```text
Defined error abstraction
```

and:

```text
Currently used error path
```

### Current state

```text
Invalid request
     |
     v
Controller
     |
     v
Zod safeParse()
     |
     v
400 response
```

`AIValidationError` is currently available as an abstraction but is not part of this shown request-validation flow.

---

# 21. Error Propagation Across Layers

The AI integration follows a layered error-propagation model.

### Controller

Responsible for:

- validating the request,
- returning `400` for invalid request data,
- calling the AI service,
- returning the successful response.

### AI Service

Responsible for:

- building prompts,
- interpreting AI output,
- parsing JSON,
- validating the AI response structure.

### Text Generation Service

Responsible for:

- feature flag checking,
- timeout,
- retry,
- retry classification,
- provider error normalization,
- logging execution duration.

### Provider

Responsible for:

- communicating with the external AI provider,
- translating the generic provider interface into the Gemini SDK call.

### Global Error Handler

Responsible for handling errors that propagate out of the controller/service stack.

This separation prevents feature-specific code from having to implement provider reliability logic.

---

# 22. Error Handling Example: Provider 503

Suppose Gemini temporarily returns:

```text
503 Service Unavailable
```

The flow is:

```text
Gemini
  |
  v
503
  |
  v
GeminiProvider
  |
  v
TextGenerationService
  |
  | isRetryableError(503)
  |
  v
true
  |
  v
Wait 1000 ms
  |
  v
Retry
```

If the retry succeeds:

```text
Retry
  |
  v
Success
  |
  v
AIService
  |
  v
Parse + Validate
  |
  v
Controller
  |
  v
200 OK
```

If all configured retries fail:

```text
Retry limit reached
       |
       v
Provider error
       |
       v
AIProviderError
       |
       v
Global error handler
```

---

# 23. Error Handling Example: Timeout

Suppose the configured timeout is:

```env
AI_TIMEOUT_MS=60000
```

and the provider does not finish within the configured time.

The flow is:

```text
Request
  |
  v
AbortController
  |
  | 60 seconds elapsed
  v
abort()
  |
  v
AITimeoutError
  |
  v
Global error handling
  |
  v
504 Gateway Timeout
```

The timeout is not retried by the current implementation.

---

# 24. Error Handling Example: Malformed AI Response

Suppose the provider returns:

```text
The result is:

{
  "suggestedTitle": "Redis Caching",
  "summary": "..."
}
```

The AI service attempts:

```ts
JSON.parse(text);
```

If parsing fails:

```text
JSON.parse()
    |
    X
    |
    v
AIResponseParseError
    |
    v
502 Bad Gateway
```

The important point is that the provider request itself may have succeeded.

The failure occurred while interpreting the provider's output.

---

# 25. Error Handling Example: Wrong Schema

Suppose the model returns:

```json
{
  "suggestedTitle": "Redis Caching"
}
```

This is valid JSON.

However, the expected response requires:

```json
{
  "suggestedTitle": "string",
  "summary": "string",
  "topics": ["string"]
}
```

Zod rejects the response:

```text
JSON.parse()
      |
      v
Valid JSON
      |
      v
Zod validation
      |
      X
      |
      v
AIResponseParseError
```

This prevents malformed AI output from reaching the client as a successful response.

---

# 26. Logging During Errors

The AI service logs important failure events.

Examples include:

### Timeout

```ts
logger.error(`[AI] Text generation timed out after ${duration}ms`);
```

### Provider error

```ts
logger.error(`[AI] Provider error after ${duration}ms: ${error.message}`);
```

### Unexpected error

```ts
logger.error(`[AI] Text generation failed after ${duration}ms: ${error}`);
```

### Retry

```ts
logger.warn(
  `[AI] Transient provider error. Retrying attempt ${attempt}/${env.AI_MAX_RETRIES} after ${delay}ms`,
);
```

### Invalid AI response

```ts
logger.error("[AI] Post assistant returned invalid JSON");
```

These logs provide visibility into whether an AI request failed because of:

- timeout,
- provider instability,
- retries,
- unexpected exceptions,
- malformed model output.

---

# 27. Security Considerations

AI error handling should not expose sensitive provider information to clients.

The current design uses application-level errors such as:

```text
AI provider request failed
```

rather than exposing raw provider SDK errors as the API contract.

API keys are also not part of the request passed to the AI service.

The provider receives the configured API key internally:

```ts
this.client = new GoogleGenAI({
  apiKey: env.GEMINI_API_KEY,
});
```

The key itself should never be logged or returned to the client.

---

# 28. Current Error-Handling Boundaries

The current implementation intentionally keeps error handling relatively small.

It handles:

- AI disabled state,
- request validation,
- provider transient failures,
- retry limits,
- exponential backoff,
- provider timeouts,
- unexpected provider errors,
- malformed JSON,
- invalid structured AI responses.

It does not currently implement a larger AI-specific error/observability system such as:

- AI usage database,
- token/cost tracking,
- provider health dashboard,
- circuit breaker,
- dead-letter queue for synchronous AI requests,
- fallback provider,
- AI-specific rate limiter on the current AI route.

These are not required for the current MVP.

---

# 29. Current Limitations

## 29.1 AI route does not currently have a dedicated rate limiter

The general API limiter is currently not globally attached:

```ts
// app.use("/api/v1", apiLimiter);
```

Authentication routes explicitly use the limiter:

```ts
app.use("/api/v1/auth", apiLimiter, authRoutes);
```

The AI route currently uses:

```ts
app.use("/api/v1/ai", aiRoutes);
```

Therefore, this documentation should not claim that the AI endpoint currently has dedicated rate limiting.

A future improvement would be to apply an appropriate limiter to AI endpoints because external model calls can consume provider quota.

---

## 29.2 Timeout retries are intentionally disabled

Timeouts immediately become:

```ts
AITimeoutError;
```

rather than being retried.

This keeps synchronous requests bounded, but a future design could introduce a more nuanced timeout/retry strategy if required.

---

## 29.3 No provider fallback

If Gemini fails, the current system does not automatically switch to another provider.

For example:

```text
Gemini
   |
   X
   |
   v
Error
```

There is currently no:

```text
Gemini
   |
   X
   |
   v
OpenAI / Groq / another provider
```

fallback chain.

The provider abstraction makes such an extension possible later without changing the feature-level service contract.

---

## 29.4 No circuit breaker

Repeated provider failures do not currently open a circuit.

Every new request can still attempt to reach the provider.

A future production-hardening step could introduce a circuit breaker to temporarily stop requests when the provider is consistently unhealthy.

---

# 30. Why Error Handling Is Inside the Shared AI Service

Retry and timeout behavior are implemented in:

```text
TextGenerationService
```

rather than inside:

```text
AIService
```

or:

```text
GeminiProvider
```

This is an important architectural decision.

If every AI feature implemented its own retry logic:

```text
Post Assistant -> retry logic
Semantic Search -> retry logic
Future Feature -> retry logic
```

the behavior would become duplicated and inconsistent.

Instead:

```text
Post Assistant
       |
       v
TextGenerationService
       |
       +--> timeout
       +--> retry
       +--> backoff
       +--> error normalization
       |
       v
Provider
```

Every feature gets the same reliability behavior.

---

# 31. Error Handling Responsibility Matrix

| Layer                 | Responsibility                                        |
| --------------------- | ----------------------------------------------------- |
| Controller            | Request validation and HTTP-level input failure       |
| DTO/Zod               | Request/response structure validation                 |
| AI Service            | Prompt construction and AI response interpretation    |
| TextGenerationService | Timeout, retry, backoff, provider error normalization |
| Provider              | External AI SDK/API communication                     |
| AI Error Classes      | Represent specific AI failure categories              |
| AppError              | Common application error abstraction                  |
| Global Error Handler  | Final application-level error response                |

This keeps the responsibilities separated.

---

# 32. Design Principles

The current implementation follows several important principles.

### 1. Fail explicitly

Different failure conditions have different error classes.

### 2. Do not retry everything

Only known transient statuses are retried.

### 3. Bound external calls

A timeout prevents an AI request from running indefinitely.

### 4. Validate AI output

Provider success does not mean the returned content is safe for application consumption.

### 5. Normalize provider failures

The rest of the application should not depend on Gemini-specific error structures.

### 6. Centralize reliability behavior

Retry and timeout logic belong to the shared text-generation service.

### 7. Keep the MVP simple

No fallback providers, circuit breakers, AI database, or complex failure infrastructure has been introduced yet.

---

# 33. End-to-End Error Flow

The complete error-handling lifecycle is:

```text
                    Client Request
                          |
                          v
                  AI Controller
                          |
                   Request validation
                     /          \
                 invalid        valid
                   |              |
                   v              v
                400          AI Service
                                  |
                                  v
                       TextGenerationService
                                  |
                           AI enabled?
                           /         \
                        no           yes
                        |              |
                       503             v
                               Provider Request
                                  |
                     +------------+-------------+
                     |            |             |
                  Timeout     Transient       Other
                     |          Error          Error
                     |            |             |
                    504         Retry            |
                                |               |
                         +------+-------+        |
                         |              |        |
                      Success       Exhausted    |
                         |              |        |
                         |             502       |
                         |              |        |
                         +------+-------+--------+
                                |
                                v
                           AI Response
                                |
                         JSON.parse()
                           /       \
                       invalid     valid
                         |           |
                        502          v
                              Zod validation
                                /       \
                            invalid     valid
                               |          |
                              502         200
```

This is the complete current Post Assistant error model.

---

# 34. Testing Error Handling

The current implementation includes unit tests for the major reliability paths.

`TextGenerationService` tests cover:

- successful generation,
- AI disabled,
- unexpected provider error normalization,
- timeout,
- retry on transient `503`,
- no retry for non-transient errors.

The AI service tests cover:

- valid JSON response,
- invalid JSON,
- valid JSON with an incorrect schema,
- propagation of `TextGenerationService` errors.

This is important because error-handling logic can easily introduce regressions if it is not tested independently from the real AI provider.

The tests use a mock provider rather than making real Gemini API calls.

---

# 35. Interview Explanation

A concise way to explain the design in an SDE interview is:

> "Since the AI provider is an external dependency, I didn't want provider failures to propagate directly through the application. I created AI-specific errors on top of our existing AppError abstraction. The shared TextGenerationService handles the reliability concerns: it checks whether AI is enabled, applies a timeout using AbortController, retries only transient provider failures such as 408, 429 and 5xx with exponential backoff, and normalizes unexpected provider errors. After the provider returns, the feature service parses and validates the AI response with Zod because a successful model call doesn't guarantee that the returned structure is valid. This keeps provider-specific reliability logic centralized while feature-specific services remain focused on business logic."

---

# 36. Likely Interview Questions

## Q1. Why did you create separate AI error classes?

**Concept:** Error handling / abstraction

**Answer approach:**

Explain that different AI failures have different meanings and HTTP semantics.

For example:

```text
Disabled -> 503
Provider failure -> 502
Timeout -> 504
Invalid AI output -> 502
```

Dedicated errors make these cases explicit and easier to handle and test.

---

## Q2. Why don't you retry every error?

**Concept:** Retry strategy

**Answer approach:**

Some errors are deterministic.

For example:

```text
400 Bad Request
401 Unauthorized
403 Forbidden
```

Retrying them without changing anything will usually produce the same failure.

Transient failures such as:

```text
408
429
5xx
```

can recover, so they are retry candidates.

---

## Q3. Why do you need a timeout?

**Concept:** Distributed systems / external dependencies

**Answer approach:**

The AI provider is outside the application's control.

Without a timeout, a request could remain pending for an unpredictable amount of time.

The timeout bounds the amount of time the synchronous API request waits for the provider.

---

## Q4. Why use `AbortController`?

**Concept:** Request cancellation

**Answer approach:**

`AbortController` provides an `AbortSignal` that can be passed through the provider abstraction to the Gemini SDK.

When the configured timeout expires, the controller aborts the request.

This gives the application a standard cancellation mechanism without coupling `TextGenerationService` directly to Gemini.

---

## Q5. Why validate the AI response if Gemini returned successfully?

**Concept:** Defensive programming / untrusted external output

**Answer approach:**

HTTP/provider success only means the provider returned a response.

It does not guarantee that the model followed the requested output format.

Therefore:

```text
AI text
 -> JSON.parse
 -> Zod schema validation
 -> application response
```

protects the application from malformed model output.

---

## Q6. Why is retry logic in `TextGenerationService` instead of `GeminiProvider`?

**Concept:** Separation of concerns

**Answer approach:**

`GeminiProvider` should primarily translate the generic provider interface into Gemini SDK calls.

Reliability behavior is provider-independent.

If another provider is added later, retry/timeout behavior should not have to be duplicated.

---

## Q7. Why don't you have a fallback provider?

**Concept:** Resilience / architecture trade-offs

**Answer approach:**

The MVP only needs one provider.

The provider abstraction was introduced so a fallback can be added later without changing feature-level services.

Adding fallback now would introduce additional complexity around:

- provider selection,
- response consistency,
- cost,
- configuration,
- testing.

---

# 37. Future Improvements

As the AI functionality grows, possible improvements include:

### 1. AI-specific rate limiting

Apply a dedicated rate limiter to expensive AI endpoints.

### 2. Provider fallback

Support:

```text
Primary Provider
      |
      X
      |
      v
Fallback Provider
```

### 3. Circuit breaker

Temporarily stop sending requests when a provider is consistently failing.

### 4. Better retry policy

Introduce:

- jitter,
- provider-specific retry-after handling,
- more precise transient error classification.

### 5. AI observability

Track:

- latency,
- failure rate,
- retry count,
- provider availability,
- model usage,
- token usage/cost where applicable.

### 6. Structured provider error mapping

Translate provider-specific error types into a more reliable internal error taxonomy rather than relying primarily on `status`/`statusCode`.

These are future improvements, not part of the current MVP implementation.

---

# 38. Current Implementation Status

| Capability                     | Status                    |
| ------------------------------ | ------------------------- |
| AI disabled handling           | Implemented               |
| Dedicated AI errors            | Implemented               |
| Provider error normalization   | Implemented               |
| Timeout                        | Implemented               |
| AbortController                | Implemented               |
| Retry on 408                   | Implemented               |
| Retry on 429                   | Implemented               |
| Retry on 5xx                   | Implemented               |
| Exponential backoff            | Implemented               |
| Retry limit                    | Implemented               |
| JSON response parsing          | Implemented               |
| Zod response validation        | Implemented               |
| Unexpected error normalization | Implemented               |
| AI-specific rate limiting      | Not currently implemented |
| Provider fallback              | Not implemented           |
| Circuit breaker                | Not implemented           |
| AI usage/cost tracking         | Not implemented           |

---

# 39. Summary

WriteSpace treats the AI provider as an external dependency and therefore isolates its failures behind a dedicated error-handling layer.

The main reliability path is:

```text
Request
  ↓
Validation
  ↓
AI Service
  ↓
TextGenerationService
  ↓
Timeout + Retry + Backoff
  ↓
AI Provider
  ↓
Response Parsing
  ↓
Zod Validation
  ↓
Application Response
```

The most important design decisions are:

1. AI failures use dedicated application errors.
2. `AppError` provides the common error abstraction.
3. External provider calls have a timeout.
4. Only transient provider failures are retried.
5. Retries use exponential backoff.
6. Retry count is configuration-driven.
7. Timeout errors are not retried by the current implementation.
8. AI output is parsed and schema-validated before reaching the client.
9. Provider-specific errors are normalized.
10. Reliability logic is centralized in `TextGenerationService`.
11. Feature-specific services remain focused on AI feature behavior.
12. More advanced resilience mechanisms are intentionally deferred until they are justified by the system's scale and requirements.

This gives the current WriteSpace AI integration a predictable failure model while keeping the architecture simple enough for the MVP.
