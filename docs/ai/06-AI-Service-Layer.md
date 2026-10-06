# AI Service Layer

## 1. Purpose

The AI Service Layer provides a stable application-level interface for text generation.

The current implementation is:

```text
src/shared/ai/services/text-generation.service.ts
```

Its primary responsibility is to sit between AI features and external AI providers.

The service handles concerns that should not belong to individual AI features or provider implementations, including:

- checking whether AI is enabled
- invoking the configured provider
- enforcing request timeouts
- retrying transient provider failures
- calculating retry backoff
- logging AI request lifecycle events
- converting unexpected failures into application-level errors

The resulting architecture is:

```text
AI Feature
    ↓
TextGenerationService
    ↓
AIProvider
    ↓
Concrete Provider
    ↓
External AI Service
```

For the current implementation:

```text
Post Assistant
    ↓
AIService
    ↓
TextGenerationService
    ↓
GeminiProvider
    ↓
Google Gemini
```

---

# 2. Why Do We Need a Separate AI Service?

A naive implementation could allow the feature service to directly call the provider:

```text
AIService
    ↓
GeminiProvider
```

However, the feature would then become responsible for many additional concerns:

```text
AIService
 ├── prompt construction
 ├── provider invocation
 ├── timeout
 ├── retries
 ├── backoff
 ├── error handling
 ├── logging
 └── provider-specific behavior
```

This would make the feature service unnecessarily complicated.

Instead, WriteSpace separates the responsibilities:

```text
AIService
    ↓
Feature-specific logic

TextGenerationService
    ↓
Generic AI execution + reliability

AIProvider
    ↓
Provider communication
```

This allows multiple AI features to reuse the same reliability infrastructure.

For example:

```text
Post Assistant ───────┐
                      │
Future AI Feature ────┼──→ TextGenerationService
                      │
Another AI Feature ───┘
```

---

# 3. Current Implementation

The current service is:

```ts
import logger from "../../../config/logger";
import env from "../../../config/env";

import { createAIProvider } from "../providers/ai-provider.factory";

import type {
  AIProvider,
  AITextGenerationRequest,
  AITextGenerationResponse,
} from "../providers/ai.provider";

import {
  AIDisabledError,
  AIProviderError,
  AITimeoutError,
} from "../errors/ai.errors";

export class TextGenerationService {
  private readonly provider: AIProvider;

  constructor(provider: AIProvider = createAIProvider()) {
    this.provider = provider;
  }

  public async generate(
    request: AITextGenerationRequest,
  ): Promise<AITextGenerationResponse> {
    if (!env.AI_ENABLED) {
      throw new AIDisabledError();
    }

    const startTime = Date.now();

    try {
      logger.debug(
        `[AI] Text generation started using provider: ${env.AI_PROVIDER}`,
      );

      const response = await this.generateWithRetry(request);

      const duration = Date.now() - startTime;

      logger.info(`[AI] Text generation completed in ${duration}ms`);

      return response;
    } catch (error) {
      const duration = Date.now() - startTime;

      if (error instanceof AITimeoutError) {
        logger.error(`[AI] Text generation timed out after ${duration}ms`);

        throw error;
      }

      if (error instanceof AIProviderError) {
        logger.error(
          `[AI] Provider error after ${duration}ms: ${error.message}`,
        );

        throw error;
      }

      logger.error(`[AI] Text generation failed after ${duration}ms: ${error}`);

      throw new AIProviderError();
    }
  }

  private async generateWithRetry(
    request: AITextGenerationRequest,
  ): Promise<AITextGenerationResponse> {
    let attempt = 0;

    while (true) {
      try {
        return await this.generateWithTimeout(request);
      } catch (error) {
        if (error instanceof AITimeoutError) {
          throw error;
        }

        if (!this.isRetryableError(error)) {
          throw error;
        }

        if (attempt >= env.AI_MAX_RETRIES) {
          throw error;
        }

        attempt++;

        const delay = this.calculateBackoffDelay(attempt);

        logger.warn(
          `[AI] Transient provider error. Retrying attempt ${attempt}/${env.AI_MAX_RETRIES} after ${delay}ms`,
        );

        await this.sleep(delay);
      }
    }
  }

  private async generateWithTimeout(
    request: AITextGenerationRequest,
  ): Promise<AITextGenerationResponse> {
    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, env.AI_TIMEOUT_MS);

    try {
      return await this.provider.generateText({
        ...request,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new AITimeoutError();
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private isRetryableError(error: unknown): boolean {
    if (!error || typeof error !== "object") {
      return false;
    }

    const providerError = error as {
      status?: number | string;
      statusCode?: number | string;
    };

    const status = Number(providerError.status ?? providerError.statusCode);

    if ([408, 429].includes(status)) {
      return true;
    }

    if (status >= 500 && status <= 599) {
      return true;
    }

    return false;
  }

  private calculateBackoffDelay(attempt: number): number {
    return 1000 * 2 ** (attempt - 1);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}

export const textGenerationService = new TextGenerationService();
```

The service can be understood as four major responsibilities:

```text
1. Guard
2. Execute
3. Retry
4. Normalize errors
```

---

# 4. Responsibility 1 — AI Feature Flag

Before making any provider request, the service checks:

```ts
if (!env.AI_ENABLED) {
  throw new AIDisabledError();
}
```

This creates a simple application-level kill switch.

The request flow therefore begins with:

```text
Request
   ↓
TextGenerationService
   ↓
AI_ENABLED?
   │
   ├── false → AIDisabledError
   │
   └── true
        ↓
     Provider
```

---

# 5. Why Check the Feature Flag Here?

The feature flag is checked in the service rather than inside `GeminiProvider`.

This is intentional.

`AI_ENABLED` represents an application-level decision:

> Should WriteSpace allow AI generation?

It is not a Gemini-specific question.

Therefore it belongs above the provider layer.

If another provider is introduced later, the same feature flag should still apply:

```text
AI_ENABLED
    ↓
TextGenerationService
    ↓
Any AIProvider
```

rather than:

```text
AI_ENABLED
    ↓
GeminiProvider only
```

---

# 6. Responsibility 2 — Request Lifecycle Logging

The service records when generation starts:

```ts
logger.debug(`[AI] Text generation started using provider: ${env.AI_PROVIDER}`);
```

It records the start time:

```ts
const startTime = Date.now();
```

After successful completion:

```ts
const duration = Date.now() - startTime;

logger.info(`[AI] Text generation completed in ${duration}ms`);
```

This provides basic latency visibility.

For example:

```text
[AI] Text generation started using provider: gemini
[AI] Text generation completed in 1842ms
```

This is useful when debugging:

- slow AI responses
- provider latency
- timeout problems
- retry behavior

---

# 7. Why Measure Duration?

AI calls are external network operations and can be significantly slower than ordinary in-process operations.

Measuring duration provides a simple performance signal.

Conceptually:

```text
Start
  ↓
Provider request
  ↓
AI processing
  ↓
Network response
  ↓
End
```

The service measures the entire operation.

This also includes time spent retrying.

Therefore the final duration represents the total time experienced by the application for that generation request.

---

# 8. Responsibility 3 — Retry Management

The public `generate()` method does not directly implement retry logic.

Instead, it delegates to:

```ts
this.generateWithRetry(request);
```

This keeps the public method small.

The flow becomes:

```text
generate()
    ↓
generateWithRetry()
    ↓
generateWithTimeout()
    ↓
provider.generateText()
```

Each method has a focused responsibility.

---

# 9. `generateWithRetry()`

The current implementation begins with:

```ts
private async generateWithRetry(
  request: AITextGenerationRequest,
): Promise<AITextGenerationResponse> {
  let attempt = 0;

  while (true) {
    ...
  }
}
```

The method repeatedly attempts the operation until one of these conditions occurs:

1. the request succeeds
2. the error is not retryable
3. the retry limit is reached
4. a timeout occurs

---

# 10. Why Use a Loop?

The retry mechanism uses:

```ts
while (true)
```

because the exact number of attempts depends on runtime behavior.

The loop terminates explicitly when:

```text
success
```

or:

```text
non-retryable error
```

or:

```text
maximum retries reached
```

occurs.

This makes the retry policy easier to understand than duplicating provider calls manually.

---

# 11. Retry Flow

The retry flow is:

```text
Attempt
  ↓
generateWithTimeout()
  ↓
Success?
  ├── YES → return response
  │
  └── NO
       ↓
    Timeout?
       ├── YES → throw timeout
       │
       └── NO
            ↓
       Retryable?
       ├── NO → throw error
       │
       └── YES
            ↓
       Retry limit reached?
       ├── YES → throw error
       │
       └── NO
            ↓
       Calculate backoff
            ↓
       Wait
            ↓
       Retry
```

---

# 12. Timeout Errors Are Not Retried

One of the most important decisions is:

```ts
if (error instanceof AITimeoutError) {
  throw error;
}
```

The service intentionally stops immediately when a timeout occurs.

The current retry policy therefore treats timeout differently from provider status failures.

Why?

A timeout already means the configured request deadline was exceeded.

Automatically repeating the request could unnecessarily increase:

- user wait time
- provider load
- API consumption

For the current MVP, timeout is therefore considered terminal.

---

# 13. Retryable Errors

The service determines whether an error is retryable using:

```ts
private isRetryableError(error: unknown): boolean
```

The current implementation considers these statuses retryable:

```text
408
429
500–599
```

Specifically:

```ts
if ([408, 429].includes(status)) {
  return true;
}

if (status >= 500 && status <= 599) {
  return true;
}
```

These generally represent conditions that may be temporary.

---

# 14. Why Not Retry Every Error?

Not every error is temporary.

For example, a malformed request or invalid configuration may continue failing on every attempt.

Blindly retrying such errors causes unnecessary requests.

The service therefore follows:

```text
Transient problem
    ↓
Retry

Permanent/invalid request
    ↓
Fail immediately
```

This distinction is important for external-service reliability.

---

# 15. HTTP 408

`408` represents a request timeout condition.

The service considers it retryable because the provider may be able to successfully process a repeated request.

The retry mechanism therefore includes:

```ts
[408, 429];
```

---

# 16. HTTP 429

`429` represents rate limiting.

The service considers it retryable.

This is useful because provider-side rate limits can sometimes be temporary.

However, the current implementation uses a simple exponential delay and does not currently read a provider-specific `Retry-After` value.

That is a possible future improvement.

---

# 17. HTTP 5xx

The service considers:

```text
500–599
```

retryable.

These are generally server-side failures.

For example:

```text
500 Internal Server Error
502 Bad Gateway
503 Service Unavailable
504 Gateway Timeout
```

can represent temporary provider infrastructure problems.

This was particularly relevant during development when the initial Gemini model returned:

```text
503 UNAVAILABLE
```

because the model was experiencing high demand.

The retry mechanism was added partly to handle this type of transient provider failure.

---

# 18. Retry Limit

The service checks:

```ts
if (attempt >= env.AI_MAX_RETRIES) {
  throw error;
}
```

The current configuration is:

```env
AI_MAX_RETRIES=2
```

Therefore the service allows bounded retry behavior rather than retrying forever.

The important distinction is:

```text
Initial request
+
Configured retries
```

The configuration represents retry attempts, not an unlimited number of total calls.

---

# 19. Exponential Backoff

After determining that a request should be retried, the service calculates a delay:

```ts
private calculateBackoffDelay(attempt: number): number {
  return 1000 * 2 ** (attempt - 1);
}
```

This produces:

```text
Attempt 1 → 1000 ms
Attempt 2 → 2000 ms
Attempt 3 → 4000 ms
Attempt 4 → 8000 ms
...
```

For the current configuration of two retries:

```text
Initial request
      ↓
Failure
      ↓
Wait 1 second
      ↓
Retry #1
      ↓
Failure
      ↓
Wait 2 seconds
      ↓
Retry #2
```

---

# 20. Why Exponential Backoff?

Immediately retrying a failed external dependency can make an outage worse.

For example:

```text
Provider overloaded
      ↓
100 clients retry immediately
      ↓
Provider receives another 100 requests
      ↓
Provider remains overloaded
```

Backoff introduces a delay:

```text
Provider overloaded
      ↓
Wait
      ↓
Retry later
```

This reduces immediate request pressure.

---

# 21. Current Backoff Formula

The formula is:

```ts
1000 * 2 ** (attempt - 1);
```

So:

```text
attempt = 1
→ 1000 × 2⁰
→ 1000 ms

attempt = 2
→ 1000 × 2¹
→ 2000 ms

attempt = 3
→ 1000 × 2²
→ 4000 ms
```

The current implementation does not include random jitter.

That can be considered as a future reliability improvement if the system grows.

---

# 22. Waiting Between Retries

The service uses:

```ts
private sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
```

Then:

```ts
await this.sleep(delay);
```

This prevents the retry from occurring immediately.

Importantly, the Node.js event loop is not blocked while waiting.

The `setTimeout` callback allows the process to continue handling other asynchronous work.

---

# 23. Responsibility 4 — Timeout Management

The retry layer calls:

```ts
this.generateWithTimeout(request);
```

rather than calling the provider directly.

This creates another layer of protection.

The structure is:

```text
generateWithRetry()
        ↓
generateWithTimeout()
        ↓
provider.generateText()
```

The timeout mechanism is implemented using `AbortController`.

---

# 24. Creating the Abort Controller

The method begins with:

```ts
const controller = new AbortController();
```

Then a timer is created:

```ts
const timeout = setTimeout(() => {
  controller.abort();
}, env.AI_TIMEOUT_MS);
```

When the configured timeout expires:

```text
Timer
  ↓
controller.abort()
  ↓
AbortSignal becomes aborted
```

---

# 25. Passing the Signal to the Provider

The provider is called with:

```ts
return await this.provider.generateText({
  ...request,
  signal: controller.signal,
});
```

The provider therefore receives the cancellation signal without needing to know how the timeout was configured.

The Gemini provider then forwards it to the Gemini SDK.

The complete chain is:

```text
AI_TIMEOUT_MS
      ↓
AbortController
      ↓
AbortSignal
      ↓
AIProvider
      ↓
GeminiProvider
      ↓
Gemini SDK
```

---

# 26. Why Use `AbortController`?

A timeout based only on:

```ts
Promise.race(...)
```

could stop waiting at the application level without necessarily communicating cancellation to the underlying operation.

The current implementation instead passes an `AbortSignal` into the provider.

This gives the provider/SDK an opportunity to cancel the client-side operation.

The service therefore has both:

```text
deadline enforcement
```

and:

```text
request cancellation signal
```

---

# 27. Timeout Error Conversion

The provider call is wrapped in:

```ts
try {
  return await this.provider.generateText({
    ...request,
    signal: controller.signal,
  });
} catch (error) {
  if (controller.signal.aborted) {
    throw new AITimeoutError();
  }

  throw error;
} finally {
  clearTimeout(timeout);
}
```

If the controller was aborted, the service converts the error into:

```ts
AITimeoutError;
```

This prevents provider-specific cancellation errors from leaking into the application.

---

# 28. Clearing the Timer

The service uses:

```ts
finally {
  clearTimeout(timeout);
}
```

This is important.

Whether the request:

- succeeds
- fails
- times out

the timer should be cleaned up.

The `finally` block guarantees cleanup.

Conceptually:

```text
Request starts
   ↓
Timer starts
   ↓
Provider request
   ↓
Success / Failure / Timeout
   ↓
clearTimeout()
```

---

# 29. Timeout vs Retry Interaction

This is an important part of the current design.

The hierarchy is:

```text
generate()
   ↓
generateWithRetry()
   ↓
generateWithTimeout()
   ↓
provider.generateText()
```

Each individual provider attempt gets the configured timeout.

For example:

```text
AI_TIMEOUT_MS = 60 seconds
AI_MAX_RETRIES = 2
```

A provider attempt is allowed up to 60 seconds.

If it returns a retryable provider error before the timeout:

```text
Attempt 1
   ↓
503
   ↓
wait 1 second
   ↓
Attempt 2
   ↓
503
   ↓
wait 2 seconds
   ↓
Attempt 3
```

The timeout is applied independently to each provider attempt.

The total operation can therefore take longer than a single timeout because retries add additional time.

This is an important distinction to understand when explaining the implementation.

---

# 30. Error Normalization

After retry/timeout processing, the public `generate()` method handles errors.

The first special case is:

```ts
if (error instanceof AITimeoutError) {
  ...
  throw error;
}
```

Timeout errors are already application-specific.

The next is:

```ts
if (error instanceof AIProviderError) {
  ...
  throw error;
}
```

These errors are also already normalized.

Anything else falls through to:

```ts
throw new AIProviderError();
```

This gives the application a predictable error boundary.

---

# 31. Why Normalize Errors?

Different AI providers may throw completely different error objects.

For example:

```text
Gemini error
OpenAI error
Mock error
Network error
SDK error
```

If those raw errors leaked into the rest of the application, controllers and feature services would need to understand every provider's error format.

Instead:

```text
Provider-specific error
        ↓
TextGenerationService
        ↓
Application-level AI error
```

This gives the application a stable error contract.

---

# 32. AI Error Types

The current AI error layer includes:

```text
AIDisabledError
AIProviderError
AITimeoutError
AIValidationError
AIResponseParseError
```

`TextGenerationService` specifically uses:

```text
AIDisabledError
AIProviderError
AITimeoutError
```

while feature-level validation and parsing use the other errors.

This maintains separation between:

```text
Infrastructure/service errors
```

and:

```text
Feature-level response errors
```

---

# 33. Error Flow

The current error flow can be summarized as:

```text
Provider Error
      ↓
Is it timeout?
      ├── YES → AITimeoutError
      │
      └── NO
           ↓
      Is it retryable?
           ├── YES → retry
           │
           └── NO
                ↓
          generate() catches
                ↓
          AIProviderError
```

This creates a consistent application-level boundary.

---

# 34. Dependency Injection

The service constructor is:

```ts
constructor(
  provider: AIProvider = createAIProvider(),
) {
  this.provider = provider;
}
```

This is an important design decision.

Production code can simply use:

```ts
new TextGenerationService();
```

and the default provider factory will be used.

Tests can instead inject a controlled provider:

```ts
new TextGenerationService(mockProvider);
```

---

# 35. Why Dependency Injection?

Without dependency injection, the service might contain:

```ts
this.provider = new GeminiProvider();
```

That would tightly couple it to Gemini.

Instead:

```text
TextGenerationService
        ↓
      AIProvider
```

The service doesn't care which implementation it receives.

This improves:

- testability
- extensibility
- separation of concerns
- provider independence

---

# 36. Singleton Service

The current implementation exports:

```ts
export const textGenerationService = new TextGenerationService();
```

This gives the application a shared service instance.

The controller currently uses:

```ts
const aiService = new AIService(textGenerationService);
```

Therefore the application reuses the same text-generation service instance rather than constructing one for every request.

---

# 37. Why a Singleton Is Reasonable Here

`TextGenerationService` currently does not maintain request-specific mutable state.

Its main dependency is the provider.

Therefore a shared instance is sufficient for the current architecture.

The service remains effectively stateless with respect to individual AI requests.

Each request receives its own:

```text
AbortController
timeout
request object
retry state
```

inside the method execution.

This prevents request-specific state from leaking between requests.

---

# 38. Request-Specific Retry State

The retry counter is created inside:

```ts
generateWithRetry();
```

using:

```ts
let attempt = 0;
```

This means each request starts with its own retry counter.

For example:

```text
Request A → attempt = 0
Request B → attempt = 0
Request C → attempt = 0
```

The singleton service does not share retry counters between requests.

This is important for concurrent API usage.

---

# 39. Request-Specific Timeout State

Similarly, each call to:

```ts
generateWithTimeout();
```

creates its own:

```ts
const controller = new AbortController();
```

and:

```ts
const timeout = setTimeout(...);
```

Therefore:

```text
Request A
  ↓
Controller A

Request B
  ↓
Controller B
```

They remain independent.

A timeout for Request A does not cancel Request B.

---

# 40. Why This Works With Node.js

The service uses asynchronous APIs:

```ts
await provider.generateText(...)
await this.sleep(...)
```

and:

```ts
setTimeout(...)
```

It does not perform synchronous blocking waits.

Therefore multiple requests can be in flight concurrently.

Conceptually:

```text
Request A → waiting for Gemini
Request B → waiting for Gemini
Request C → waiting for Gemini

        ↓

Node.js event loop continues handling work
```

This is consistent with the asynchronous nature of the existing Node.js backend.

---

# 41. Separation of Responsibilities

The service intentionally does not:

- build Post Assistant prompts
- parse Post Assistant JSON
- validate Post Assistant response structure
- know about posts
- know about users
- directly access the database
- directly access Gemini SDK
- select feature-specific output fields

Those responsibilities belong elsewhere.

The service focuses on generic text-generation execution.

---

# 42. Layer Responsibilities

The complete responsibility split is:

| Layer                 | Responsibility                             |
| --------------------- | ------------------------------------------ |
| Controller            | HTTP request/response                      |
| DTO                   | Input/output validation                    |
| AI Feature Service    | Feature-specific prompt and response logic |
| TextGenerationService | Generic AI execution and reliability       |
| AIProvider            | Provider abstraction                       |
| GeminiProvider        | Gemini SDK communication                   |
| Gemini SDK            | External provider communication            |

This is one of the key architectural properties of the AI implementation.

---

# 43. Example: Post Assistant Request

Suppose the client sends:

```json
{
  "title": "Understanding Redis Caching",
  "content": "Redis is an in-memory data store...",
  "instruction": "Make the suggestions suitable for backend developers."
}
```

The flow is:

```text
HTTP Request
      ↓
AIController
      ↓
Zod validation
      ↓
AIService
      ↓
Build prompt
      ↓
TextGenerationService.generate()
      ↓
AI enabled?
      ↓
generateWithRetry()
      ↓
generateWithTimeout()
      ↓
GeminiProvider
      ↓
Gemini SDK
      ↓
Gemini
      ↓
AITextGenerationResponse
      ↓
AIService parses JSON
      ↓
Response validation
      ↓
HTTP Response
```

The TextGenerationService is therefore responsible for only the middle part:

```text
AIService
   ↓
TextGenerationService
   ↓
Provider
   ↓
External AI
```

---

# 44. Example: Provider Returns 503

Suppose Gemini returns:

```text
503 UNAVAILABLE
```

The flow becomes:

```text
Gemini
   ↓
503
   ↓
GeminiProvider
   ↓
TextGenerationService
   ↓
isRetryableError() → true
   ↓
wait 1000ms
   ↓
retry
```

If the next attempt succeeds:

```text
Retry
  ↓
Success
  ↓
Return response
```

If all configured retries fail:

```text
Retry limit reached
  ↓
throw provider error
  ↓
AIProviderError
```

---

# 45. Example: Provider Times Out

Suppose:

```env
AI_TIMEOUT_MS=60000
```

and Gemini does not complete the request within the configured period.

The flow becomes:

```text
Provider request
      ↓
60 seconds
      ↓
AbortController.abort()
      ↓
AbortSignal
      ↓
Provider cancellation
      ↓
AITimeoutError
      ↓
TextGenerationService
      ↓
Do not retry
      ↓
Controller
```

The application therefore returns a controlled timeout error instead of allowing the request to remain pending indefinitely.

---

# 46. Example: Non-Retryable Error

Suppose the provider returns an error that does not match:

```text
408
429
5xx
```

Then:

```ts
if (!this.isRetryableError(error)) {
  throw error;
}
```

The service does not retry.

The error then reaches the public `generate()` method and is normalized into an `AIProviderError` if necessary.

This prevents useless repeated requests.

---

# 47. Why Reliability Logic Is Centralized

Imagine WriteSpace eventually has:

```text
AI Post Assistant
AI Content Improver
AI Summarizer
AI Topic Generator
AI Notification Generator
```

If each feature implemented its own:

```text
timeout
retry
backoff
logging
error normalization
```

the codebase could become:

```text
Post Assistant
 ├── retry
 ├── timeout
 └── logging

Content Improver
 ├── retry
 ├── timeout
 └── logging

Summarizer
 ├── retry
 ├── timeout
 └── logging
```

Instead, WriteSpace centralizes these concerns:

```text
Post Assistant ──────┐
Content Improver ────┤
Summarizer ──────────┼──→ TextGenerationService
Topic Generator ─────┤
Future AI Feature ───┘
```

This avoids duplication and keeps AI features focused on their actual business requirements.

---

# 48. Why We Do Not Put Business Logic Here

The service should remain generic.

For example, this would be inappropriate:

```ts
if (feature === "post-assistant") {
  ...
}
```

The service should not know what a Post Assistant is.

It should simply provide:

```ts
generate(request);
```

This allows the same service to support multiple text-generation use cases.

---

# 49. Current Limitations

The current service is intentionally simple, but there are some areas that can be improved later.

### No jitter

Backoff currently uses deterministic delays:

```text
1s
2s
4s
8s
```

A future implementation could add random jitter.

### No `Retry-After` support

For `429` responses, the service currently does not inspect provider-specific retry timing.

### No circuit breaker

Repeated provider failures do not currently open a circuit.

### No per-user quota

The service does not track AI usage per user.

### No token/cost tracking

The service currently logs latency but does not track:

- input tokens
- output tokens
- estimated cost
- provider consumption

These are future concerns rather than MVP requirements.

---

# 50. Why These Features Were Deferred

The current goal is to build a reliable but simple AI foundation for WriteSpace.

Introducing:

```text
circuit breaker
usage database
cost tracking
quota engine
distributed retry coordination
```

before they are needed would increase implementation complexity.

The current architecture keeps the extension points open without prematurely implementing all of them.

---

# 51. Testing the Service

`TextGenerationService` has automated tests covering the important behaviors.

Current test scenarios include:

```text
✓ successful generation
✓ AI disabled
✓ unexpected provider error normalization
✓ timeout
✓ retry on transient 503
✓ no retry for non-transient error
```

These tests are particularly valuable because the service contains reliability behavior that should remain deterministic.

---

# 52. Why Mock Providers Are Important Here

The tests do not need to call Gemini.

Instead, the service can receive a fake provider.

For example, a test provider can simulate:

```text
Success
503
Timeout
Permanent error
```

This lets the tests verify the service's behavior independently of external infrastructure.

Therefore:

```text
TextGenerationService
        ↓
Mock/Fake Provider
```

is sufficient for testing retry and timeout behavior.

---

# 53. Test Architecture

Conceptually:

```text
                 TextGenerationService
                         │
                         ▼
                   AIProvider
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
       Real Gemini             Test Provider
       Provider                / Mock
```

Production:

```text
TextGenerationService
        ↓
GeminiProvider
```

Tests:

```text
TextGenerationService
        ↓
Mock/Test Provider
```

The service itself remains unchanged.

---

# 54. Interview Explanation

If asked:

> "What is the responsibility of your TextGenerationService?"

A strong answer would be:

> "It is the application-level orchestration layer for text generation. It sits between AI features and the provider abstraction. It checks whether AI is enabled, invokes the provider, applies timeout and retry policies, uses exponential backoff for transient failures, logs request duration, and normalizes unexpected provider errors. This allows individual AI features to focus on their business logic instead of duplicating reliability code."

---

If asked:

> "Why not put retries inside GeminiProvider?"

Answer:

> "Retry is not inherently Gemini-specific. It's an application-level reliability policy. If I put it inside GeminiProvider, every future provider would need its own implementation. By putting it in TextGenerationService, all providers get the same retry behavior."

---

If asked:

> "How do you handle transient failures?"

Answer:

> "I classify provider errors by status. Currently 408, 429, and 5xx responses are considered retryable. Retries are bounded by `AI_MAX_RETRIES`, and I use exponential backoff starting at one second. Non-retryable errors fail immediately."

---

If asked:

> "How do you prevent an AI request from hanging indefinitely?"

Answer:

> "Each provider attempt gets its own `AbortController`. A timer uses `AI_TIMEOUT_MS` to abort the request, and the signal is passed through the provider abstraction to the Gemini SDK. If the signal is aborted, I convert the failure into an `AITimeoutError`."

---

If asked:

> "Does timeout retry automatically?"

Answer:

> "Not in the current implementation. `AITimeoutError` is treated as terminal by `generateWithRetry()`. The reasoning is to avoid repeatedly issuing a request that already exceeded the configured deadline and unnecessarily increasing latency and provider usage."

---

If asked:

> "Can multiple requests use the same TextGenerationService?"

Answer:

> "Yes. The exported service is a shared instance, but it doesn't maintain request-specific mutable state. Retry counters and AbortControllers are created inside each method invocation, so concurrent requests maintain independent state."

---

# 55. Key Engineering Lessons

The service demonstrates several real-world backend engineering concepts.

### External dependency isolation

```text
Application
    ↓
Service
    ↓
Provider
    ↓
External API
```

### Bounded retries

Never retry indefinitely.

### Exponential backoff

Give a temporarily unhealthy dependency time to recover.

### Timeout enforcement

Do not allow external operations to hang indefinitely.

### Error normalization

Hide provider-specific error details behind application-level errors.

### Dependency injection

Allow implementations to be replaced during testing.

### Separation of concerns

Keep feature logic separate from infrastructure reliability.

### Reusable infrastructure

One service can support multiple AI features.

---

# 56. Current AI Service Architecture

The complete current architecture is:

```text
                    ┌──────────────────────┐
                    │     AIController     │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │       AIService      │
                    │ Feature Logic        │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │ TextGenerationService│
                    │                      │
                    │ • feature flag       │
                    │ • timeout            │
                    │ • retries            │
                    │ • backoff            │
                    │ • logging            │
                    │ • error normalization│
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │     AIProvider       │
                    │      Interface       │
                    └──────────┬───────────┘
                               │
                    ┌──────────┴──────────┐
                    ▼                     ▼
          ┌─────────────────┐   ┌─────────────────┐
          │ GeminiProvider  │   │ MockAIProvider  │
          └────────┬────────┘   └─────────────────┘
                   │
                   ▼
          ┌─────────────────┐
          │ GoogleGenAI SDK │
          └────────┬────────┘
                   │
                   ▼
              Gemini API
```

---

# 57. Current Status

The AI Service Layer is **fully implemented and tested** for the current MVP.

Implemented:

```text
✓ AI feature flag
✓ Provider abstraction
✓ Dependency injection
✓ Text
```
