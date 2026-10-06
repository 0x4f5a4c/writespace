# AI Reliability

## 1. Purpose

AI functionality introduces an external dependency into WriteSpace.

Unlike normal application logic, an AI request depends on:

- network connectivity,
- an external provider,
- provider availability,
- provider rate limits,
- model availability,
- provider response time,
- model output correctness.

Because of this, the AI subsystem needs reliability mechanisms that prevent an external AI failure from unnecessarily destabilizing the application.

The current WriteSpace AI implementation focuses on a small set of practical reliability mechanisms:

- feature flagging,
- request validation,
- input-size limits,
- provider abstraction,
- configurable timeouts,
- request cancellation,
- controlled retries,
- exponential backoff,
- response validation,
- error normalization,
- structured logging,
- mock-provider testing.

The goal is not to build a complex distributed-systems reliability platform for the MVP.

Instead, the goal is to make the current synchronous AI feature predictable and safe enough while keeping the architecture extensible.

---

# 2. Reliability Goals

The current AI reliability design has several goals.

### Goal 1 — Do not allow AI requests to run indefinitely

A provider request must have a configured timeout.

### Goal 2 — Recover from transient provider failures

Temporary failures such as:

- `408`,
- `429`,
- `5xx`

are retryable.

### Goal 3 — Avoid unlimited retries

The number of retries is configuration-driven.

### Goal 4 — Avoid retry storms

Retries use exponential backoff rather than immediately repeating the request.

### Goal 5 — Prevent malformed AI output from entering the application

AI responses are parsed and validated before being returned.

### Goal 6 — Allow AI to be disabled

The application can operate with AI functionality disabled.

### Goal 7 — Keep provider failures isolated

Provider-specific failures are converted into application-level errors.

### Goal 8 — Keep reliability logic provider-independent

Timeout and retry behavior are implemented in the shared AI service rather than inside Gemini-specific feature code.

---

# 3. Reliability Architecture

The current reliability architecture is:

```text id="x9s2pk"
                    Client
                      |
                      v
               AI Controller
                      |
               Request Validation
                      |
                      v
                 AI Service
                      |
                      v
          TextGenerationService
                      |
          +-----------+-----------+
          |           |           |
          v           v           v
      Feature      Timeout      Retry
      Flagging    + Abort      + Backoff
          |           |           |
          +-----------+-----------+
                      |
                      v
                AI Provider
                      |
                      v
              External AI API
                      |
                      v
                AI Response
                      |
               +------+------+
               |             |
             Parse         Schema
               |          Validation
               +------+------+
                      |
                      v
                Application
```

The important point is that reliability is implemented around the provider boundary.

The feature itself does not need to know how Gemini handles:

- retries,
- timeout,
- transient failures,
- request cancellation.

---

# 4. Reliability Boundary

The most important reliability boundary is:

```text id="y2m0xv"
WriteSpace
     |
     | Provider abstraction
     |
     v
External AI Provider
```

Everything beyond this boundary is outside the application's direct control.

The application therefore assumes that:

```text id="2cbx7m"
Provider may:
- be unavailable
- be slow
- reject requests
- rate-limit requests
- return malformed output
- temporarily fail
```

The reliability layer is responsible for protecting the application from these conditions.

---

# 5. Feature Flag as a Reliability Mechanism

AI can be disabled using:

```env id="5g6q2p"
AI_ENABLED=false
```

The `TextGenerationService` checks this before contacting the provider:

```ts id="q2h7m4"
if (!env.AI_ENABLED) {
  throw new AIDisabledError();
}
```

This is more than a configuration option.

It acts as a basic operational control.

If the AI provider becomes problematic, the application can stop making AI requests without removing the AI feature code.

The flow becomes:

```text id="3e2m6h"
Request
   |
   v
AI Service
   |
   v
AI_ENABLED?
   |
  No
   |
   v
AIDisabledError
```

This avoids unnecessary external calls.

---

# 6. Input Size Limiting

Large AI inputs can increase:

- processing time,
- provider usage,
- response latency,
- token consumption,
- probability of provider rejection.

The current configuration contains:

```env id="8bq6kr"
AI_MAX_INPUT_CHARS=12000
```

The Post Assistant DTO applies this limit:

```ts id="g3e2h1"
content: z
  .string()
  .trim()
  .min(1, "Content is required")
  .max(
    env.AI_MAX_INPUT_CHARS,
    `Content cannot exceed ${env.AI_MAX_INPUT_CHARS} characters`,
  ),
```

This provides an application-side boundary before the request reaches Gemini.

The flow is:

```text id="m9x7q1"
User Input
   |
   v
Zod Validation
   |
   +---- Too large ----> 400
   |
   +---- Valid --------> AI request
```

This is an important reliability control because it prevents unnecessarily large synchronous AI requests.

---

# 7. Configurable Timeout

External dependencies should not be allowed to block an application request indefinitely.

WriteSpace uses:

```env id="0y9j6k"
AI_TIMEOUT_MS=60000
```

The `TextGenerationService` creates an `AbortController`:

```ts id="w3j2s7"
const controller = new AbortController();

const timeout = setTimeout(() => {
  controller.abort();
}, env.AI_TIMEOUT_MS);
```

The signal is passed through the provider abstraction:

```ts id="8c4n6z"
return await this.provider.generateText({
  ...request,
  signal: controller.signal,
});
```

The provider passes it to the Gemini SDK.

This means the application has a bounded waiting period for an AI request.

---

# 8. Why Timeout Is Important

Without a timeout:

```text id="2c7x5k"
Client
  |
  v
WriteSpace
  |
  v
Gemini
  |
  X
  |
  | hangs
  |
  |
  |
```

the original API request could remain pending for an unpredictable amount of time.

With a timeout:

```text id="7t8m2v"
Client
  |
  v
WriteSpace
  |
  v
Gemini
  |
  | exceeds timeout
  v
AbortController
  |
  v
AITimeoutError
  |
  v
504
```

The system therefore has a defined upper bound for the synchronous AI operation.

---

# 9. Request Cancellation

Timeouts are implemented using `AbortController`.

The generic provider interface accepts:

```ts id="0m5y1k"
signal?: AbortSignal;
```

This is an important architectural detail.

The shared AI service does not need to know that the provider is Gemini.

Instead:

```text id="j8q2xm"
TextGenerationService
       |
       | AbortSignal
       v
AIProvider
       |
       v
GeminiProvider
       |
       v
Gemini SDK
```

The provider abstraction therefore supports cancellation without coupling the service to a specific provider SDK.

---

# 10. Retry Strategy

Not every provider failure means that the provider is permanently unavailable.

Some failures are transient.

The current implementation considers these statuses retryable:

```ts id="6n3c9p"
if ([408, 429].includes(status)) {
  return true;
}

if (status >= 500 && status <= 599) {
  return true;
}
```

Therefore:

|         Status | Meaning                      | Retry |
| -------------: | ---------------------------- | ----- |
|            408 | Request Timeout              | Yes   |
|            429 | Too Many Requests            | Yes   |
|        500–599 | Provider server-side failure | Yes   |
| Other statuses | Not considered transient     | No    |

This keeps the retry policy conservative.

---

# 11. Why Retry Only Transient Failures?

Consider a provider returning:

```text id="x4y6m2"
401 Unauthorized
```

Retrying the same request does not normally solve an authentication problem.

Similarly:

```text id="t1p8r4"
400 Bad Request
```

usually indicates that the request itself needs to change.

Automatically retrying these errors would:

- waste provider requests,
- increase latency,
- potentially increase cost,
- delay the final failure.

Transient errors are different.

A `503`, for example, may succeed a moment later.

Therefore the system retries only errors that have a reasonable chance of recovering without changing the request.

---

# 12. Retry Limit

The retry count is controlled by:

```env id="e3p9qk"
AI_MAX_RETRIES=2
```

The service checks:

```ts id="j1r6mx"
if (attempt >= env.AI_MAX_RETRIES) {
  throw error;
}
```

This prevents infinite retry loops.

With the current configuration:

```text id="v8w2s6"
Initial request
      |
      X
      |
   Retry #1
      |
      X
      |
   Retry #2
      |
      X
      |
     Stop
```

The system therefore performs a bounded amount of recovery work.

---

# 13. Exponential Backoff

Retries are not performed immediately.

The current backoff function is:

```ts id="k7v3p1"
private calculateBackoffDelay(attempt: number): number {
  return 1000 * 2 ** (attempt - 1);
}
```

The delays are:

```text id="n5c1w8"
Attempt 1 -> 1000 ms
Attempt 2 -> 2000 ms
Attempt 3 -> 4000 ms
Attempt 4 -> 8000 ms
Attempt 5 -> 16000 ms
```

Because the current configuration is:

```env id="b0k4j7"
AI_MAX_RETRIES=2
```

the configured retry delays are:

```text id="v2f9n3"
1 second
2 seconds
```

---

# 14. Why Exponential Backoff?

Immediate retries can create a retry storm.

For example:

```text id="p5d8r2"
Request
  |
  X
  |
Retry immediately
  |
  X
  |
Retry immediately
  |
  X
```

If many application requests behave this way simultaneously, they can increase pressure on an already unhealthy provider.

Backoff instead spaces requests:

```text id="s7m2k9"
Request
  |
  X
  |
  | 1 second
  v
Retry
  |
  X
  |
  | 2 seconds
  v
Retry
```

This gives the external provider some time to recover.

---

# 15. Current Backoff vs Future Improvement

The current implementation uses exponential backoff:

```text id="0r5y1c"
1000 ms
2000 ms
4000 ms
...
```

It does not currently add random jitter.

In a large distributed system, multiple application instances could retry at approximately the same time.

A future implementation could use:

```text id="p2x7m5"
Exponential Backoff + Jitter
```

to reduce synchronized retries.

This is a future reliability improvement rather than part of the current implementation.

---

# 16. Timeout and Retry Interaction

Timeout and retry are deliberately treated differently.

Current behavior:

```text id="d6h8q1"
Provider request
      |
      +---- Timeout ----> AITimeoutError
      |
      +---- 408 --------> Retry
      |
      +---- 429 --------> Retry
      |
      +---- 5xx --------> Retry
```

A timeout generated by the application's own `AbortController` is not retried:

```ts id="m7p2x4"
if (error instanceof AITimeoutError) {
  throw error;
}
```

This is an important boundary.

If every timeout were retried automatically, a slow provider could cause several sequential long waits for one client request.

For the current synchronous MVP, the implementation chooses bounded latency over aggressive recovery.

---

# 17. Total Request Latency

Because retries are synchronous, the total request duration can be greater than the configured timeout.

For example, conceptually:

```text id="n8q4w2"
Initial attempt
     |
     | up to timeout
     v
Failure
     |
     | 1s backoff
     v
Retry
     |
     | up to timeout
     v
Failure
     |
     | 2s backoff
     v
Retry
```

Therefore, timeout configuration and retry configuration should be considered together.

The timeout bounds each provider attempt, while the retry count bounds how many additional attempts can occur.

The current implementation intentionally keeps both values configurable.

---

# 18. Provider Abstraction as a Reliability Mechanism

The provider abstraction is not only an architectural convenience.

It also helps reliability.

The interface is:

```ts id="r1m5c8"
export interface AIProvider {
  generateText(
    request: AITextGenerationRequest,
  ): Promise<AITextGenerationResponse>;
}
```

The service depends on this interface:

```text id="q6w3t9"
TextGenerationService
        |
        v
   AIProvider
      /   \
     /     \
Gemini    Mock
```

This means the reliability layer does not need to know provider-specific implementation details.

For example, the same timeout/retry logic can be used with:

```text id="h4k9v2"
GeminiProvider
FutureProvider
MockAIProvider
```

---

# 19. Provider Failure Isolation

The provider implementation contains Gemini-specific logic:

```ts id="z8c2q6"
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

The rest of the application does not need to know about the Gemini SDK.

This reduces the blast radius of provider-specific changes.

If the provider changes later, the feature/service layer can continue using the same interface.

---

# 20. Error Normalization

A provider may return errors in a provider-specific structure.

The current service checks common status fields:

```ts id="f4m8s2"
const providerError = error as {
  status?: number | string;
  statusCode?: number | string;
};

const status = Number(providerError.status ?? providerError.statusCode);
```

It then decides whether the failure is retryable.

Unexpected errors are normalized into:

```ts id="k3v7p5"
AIProviderError;
```

This keeps the rest of the application independent from provider-specific error objects.

---

# 21. Response Validation as Reliability

Reliability is not only about network failures.

A provider can successfully respond while still returning unusable data.

For the Post Assistant:

```text id="w4x7q2"
Provider Success
      |
      v
Response Text
      |
      v
JSON.parse()
      |
      v
Zod Schema
      |
      +---- invalid ---> AIResponseParseError
      |
      v
Valid Application Data
```

This protects the rest of the application from malformed AI output.

This is especially important because model output is not deterministic in the same way as normal application code.

---

# 22. Structured Output Contract

The Post Assistant expects:

```json id="r7k1n4"
{
  "suggestedTitle": "string",
  "summary": "string",
  "topics": ["string"]
}
```

The service validates:

```ts id="q5v8j3"
export const postAssistantResponseSchema = z.object({
  suggestedTitle: z.string().min(1),
  summary: z.string().min(1),
  topics: z.array(z.string()).min(1),
});
```

This gives the feature a stable application-level contract even though the actual content is generated by a model.

---

# 23. Graceful Degradation

The current MVP treats AI as an optional capability rather than a dependency required for core WriteSpace functionality.

This is reflected in:

```env id="s2m7x9"
AI_ENABLED=false
```

The core blogging functionality does not depend on the Post Assistant to function.

Therefore:

```text id="u8p4c6"
AI unavailable
     |
     v
AI feature unavailable
     |
     v
Core WriteSpace
     |
     v
Continues operating
```

This is an important reliability decision.

The AI assistant improves the user experience, but it is not part of the fundamental blog-post creation path.

---

# 24. Synchronous AI Feature Trade-off

The current Post Assistant is synchronous:

```text id="n3y6w8"
Client
  |
  v
POST /ai/post-assistant
  |
  v
AI Provider
  |
  v
Response
```

This was intentionally kept simple for the MVP.

The advantages are:

- simple API,
- immediate result,
- simple frontend integration,
- no job-status system,
- no additional persistence.

The disadvantage is that the user request remains dependent on provider latency.

Therefore timeout and retry controls are particularly important for this architecture.

---

# 25. Why Semantic Search Will Need Different Reliability

The planned Semantic Search feature has a different execution model.

For semantic search, embedding generation can be moved to asynchronous processing:

```text id="p7v3n1"
Post Published
     |
     v
BullMQ Job
     |
     v
AI Worker
     |
     v
Embedding Provider
     |
     v
Vector Storage
```

This changes the reliability strategy.

A background worker can tolerate retries differently from a synchronous HTTP request.

For example:

```text id="h2m8q5"
Synchronous AI
    |
    v
Bounded request latency
```

versus:

```text id="y6r1t4"
Asynchronous AI
    |
    v
Job retry
    |
    v
Backoff
    |
    v
Dead-letter/failure handling
```

The existing Redis/BullMQ infrastructure can eventually be reused for this.

---

# 26. Reliability Strategy for Future Semantic Search

The planned asynchronous embedding workflow could eventually support:

- job retries,
- exponential backoff,
- failed-job tracking,
- worker concurrency control,
- idempotency,
- dead-letter handling,
- embedding generation monitoring.

These mechanisms are not part of the current Post Assistant implementation.

They become relevant when Semantic Search is implemented.

---

# 27. Rate Limiting — Current State

Rate limiting is an important AI reliability concern because AI provider calls can consume:

- provider quota,
- application resources,
- network resources,
- latency budget.

However, the current AI route does not have a dedicated rate limiter.

The application currently has:

```ts id="k8m1x6"
// app.use("/api/v1", apiLimiter);
```

commented out globally.

Authentication routes explicitly use:

```ts id="c4v9p2"
app.use("/api/v1/auth", apiLimiter, authRoutes);
```

while the AI route currently uses:

```ts id="w6x2m9"
app.use("/api/v1/ai", aiRoutes);
```

Therefore:

> Dedicated AI endpoint rate limiting is currently a reliability/security gap rather than an implemented feature.

This should be addressed before exposing AI functionality to a large public user base.

---

# 28. Why AI Rate Limiting Matters

Without appropriate protection, a client could repeatedly call:

```text id="z1r5q8"
POST /api/v1/ai/post-assistant
```

which could result in:

```text id="a9m3k7"
Client
  |
  +--> AI request
  +--> AI request
  +--> AI request
  +--> AI request
  +--> ...
```

Potential consequences include:

- provider quota exhaustion,
- increased latency,
- increased application load,
- increased cost if the provider plan changes,
- abuse of the AI feature.

A future AI-specific limiter should therefore be considered before public-scale deployment.

---

# 29. Redis and Future AI Rate Limiting

WriteSpace already uses Redis-backed infrastructure elsewhere.

Therefore, if AI-specific rate limiting is introduced later, the existing Redis infrastructure can potentially be reused rather than introducing another state-management system.

A conceptual future design could be:

```text id="x5k8p1"
Client
   |
   v
AI Rate Limiter
   |
   +---- limit exceeded ---> 429
   |
   +---- allowed ----------> AI Service
```

The exact policy should depend on:

- authenticated user identity,
- endpoint,
- provider quota,
- expected traffic,
- product requirements.

This is future design, not current behavior.

---

# 30. Logging and Observability

Reliability requires visibility into failures.

The current AI service logs:

- provider invocation,
- successful completion,
- duration,
- retries,
- timeout,
- provider errors,
- unexpected failures.

For example:

```ts id="p4c7v2"
logger.info(`[AI] Text generation completed in ${duration}ms`);
```

This makes latency observable.

Retry behavior is also logged:

```ts id="n7w2k5"
logger.warn(
  `[AI] Transient provider error. Retrying attempt ${attempt}/${env.AI_MAX_RETRIES} after ${delay}ms`,
);
```

This makes transient instability visible.

---

# 31. Latency Measurement

The service records the start time:

```ts id="r8m4q6"
const startTime = Date.now();
```

and calculates:

```ts id="c2x7n5"
const duration = Date.now() - startTime;
```

This duration is logged when generation succeeds or fails.

This is useful for identifying:

- slow provider responses,
- frequent timeout conditions,
- latency changes,
- retry-heavy requests.

Currently this information is logged rather than stored in a dedicated metrics system.

---

# 32. Current Observability vs Future Observability

### Current

```text id="m6q1x8"
AI Request
    |
    v
Logger
    |
    +--> duration
    +--> retry
    +--> timeout
    +--> provider failure
```

### Future

```text id="b3v9k2"
AI Request
    |
    +--> Logs
    +--> Metrics
    +--> Traces
    +--> Provider health
    +--> Usage/cost metrics
```

The current logging system is sufficient for the MVP but can later be extended into centralized observability.

---

# 33. Testing Reliability

The AI reliability layer is tested independently from the real provider.

The `TextGenerationService` tests cover:

- successful generation,
- AI disabled,
- unexpected provider error,
- timeout,
- retry on transient `503`,
- no retry for non-transient errors.

This is important because real provider calls are:

- slower,
- nondeterministic,
- dependent on external availability,
- unsuitable for most unit tests.

---

# 34. Mock Provider

The mock provider implements the same interface:

```ts id="u2c6p8"
export class MockAIProvider implements AIProvider {
  async generateText(
    _request: AITextGenerationRequest,
  ): Promise<AITextGenerationResponse> {
    return {
      text: "This is a mock AI response.",
    };
  }
}
```

The factory can select it:

```env id="v7m1x3"
AI_PROVIDER=mock
```

This allows application logic to be tested without making real Gemini calls.

---

# 35. Testing Failure Scenarios

A reliable AI subsystem should test both success and failure.

The current tests specifically exercise scenarios such as:

```text id="q9x4c2"
Success
  |
  v
Response returned

AI disabled
  |
  v
AIDisabledError

Provider 503
  |
  v
Retry
  |
  v
Success/failure

Timeout
  |
  v
AITimeoutError

Non-transient provider error
  |
  v
No retry

Malformed JSON
  |
  v
AIResponseParseError

Invalid response schema
  |
  v
AIResponseParseError
```

This provides confidence that reliability behavior is not accidentally changed when the AI subsystem evolves.

---

# 36. Real Provider Failure During Development

During development, the initial configured Gemini model:

```text id="y7p3m1"
gemini-3.8-flash
```

returned a `503` high-demand error.

The failure was reproduced using the SDK directly.

A different available model:

```text id="f4n8q2"
gemini-3.5-flash-lite
```

was then tested successfully and verified through the actual WriteSpace endpoint.

This development experience reinforced an important reliability principle:

> External model availability cannot be assumed even when the application code is correct.

The provider abstraction and retry logic therefore remain useful even when application-side implementation is correct.

---

# 37. Reliability Lessons From Provider Availability

The model-availability issue demonstrated that AI reliability has multiple layers:

```text id="j5r2x8"
Application
    |
    v
Provider SDK
    |
    v
Model Availability
    |
    v
Provider Infrastructure
```

A failure at the model/provider layer can occur without any application bug.

Therefore, AI integrations should avoid assuming:

```text
"API call succeeded yesterday"
```

means:

```text
"API call will always succeed."
```

---

# 38. Provider Selection and Reliability

The provider abstraction also makes provider changes less disruptive.

Current:

```text id="s4n7p2"
AIService
    |
    v
TextGenerationService
    |
    v
GeminiProvider
```

Potential future architecture:

```text id="w8c3m6"
AIService
    |
    v
TextGenerationService
    |
    v
AIProvider
   /   \
Gemini  Other
```

Feature-level code does not need to know which provider is currently selected.

This reduces the coupling between business features and external provider infrastructure.

---

# 39. Configuration as a Reliability Control Plane

The AI configuration contains several reliability-related values:

```env id="e5m2k9"
AI_ENABLED=true
AI_TIMEOUT_MS=60000
AI_MAX_INPUT_CHARS=12000
AI_MAX_OUTPUT_TOKENS=1000
AI_MAX_RETRIES=2
```

These values allow behavior to change without modifying application logic.

For example:

```text id="n6q1v8"
AI_ENABLED
    |
    +--> Operational enable/disable

AI_TIMEOUT_MS
    |
    +--> Request latency boundary

AI_MAX_RETRIES
    |
    +--> Recovery attempts

AI_MAX_INPUT_CHARS
    |
    +--> Request size boundary

AI_MAX_OUTPUT_TOKENS
    |
    +--> Output-size boundary
```

This makes configuration an important part of the reliability design.

---

# 40. Reliability vs Availability

The AI feature itself is not treated as a mandatory dependency for WriteSpace.

Therefore, WriteSpace can remain available even when AI is unavailable.

This is an important distinction:

```text id="z4k8p1"
WriteSpace availability
        !=
AI provider availability
```

The application can continue supporting core functionality while the optional AI feature is disabled or unavailable.

This is a form of graceful degradation.

---

# 41. Reliability vs Consistency

For the current Post Assistant feature, AI output is advisory.

The AI does not directly modify persistent post data.

The current flow is:

```text id="u1c5m9"
Post content
    |
    v
AI
    |
    v
Suggestions
    |
    v
Client
```

The result is not automatically persisted into the database.

This reduces the reliability impact of an AI failure.

If the AI request fails:

```text id="k2x6q4"
AI failure
    |
    v
No database corruption
    |
    v
Existing post data remains unaffected
```

This is one of the reasons the MVP design deliberately avoids making AI part of the critical post-write transaction.

---

# 42. No AI Dependency in Core Post Creation

The current Post Assistant is a separate endpoint:

```text id="h7m3q9"
POST /api/v1/ai/post-assistant
```

It is not embedded into the normal post-creation transaction.

Therefore:

```text id="p8v4n2"
Create Post
   |
   v
Database
```

does not depend on:

```text id="d6q1x7"
Gemini
```

This keeps the core blogging workflow resilient to AI outages.

---

# 43. Synchronous Reliability Trade-off

The current architecture is intentionally synchronous because the Post Assistant needs to return suggestions immediately.

This creates a trade-off:

| Approach     | Advantage                          | Disadvantage                             |
| ------------ | ---------------------------------- | ---------------------------------------- |
| Synchronous  | Immediate result, simple API       | User waits for provider                  |
| Asynchronous | Better tolerance for slow provider | More infrastructure and state management |

For the current Post Assistant:

```text
Synchronous
```

is appropriate for the MVP.

For future embedding generation:

```text
Asynchronous
```

is more appropriate.

---

# 44. Reliability Principles for Future AI Features

Every new AI feature should answer these questions before implementation:

### 1. Is the feature synchronous or asynchronous?

This determines how latency and retries should work.

### 2. What happens if the provider is unavailable?

The feature should have a defined failure behavior.

### 3. Is the AI response trusted?

If not, parse and validate it.

### 4. What failures are retryable?

Avoid blindly retrying every exception.

### 5. What is the maximum request duration?

Define a timeout.

### 6. What is the maximum input size?

Prevent unnecessarily large requests.

### 7. Can the feature degrade gracefully?

AI should not unnecessarily break core WriteSpace functionality.

### 8. Does the endpoint require rate limiting?

AI requests can be significantly more expensive than normal API requests.

---

# 45. Current Reliability Architecture

The current implementation can be summarized as:

```text id="r3n7k5"
                    WriteSpace
                        |
                +-------+-------+
                |               |
          Core Features      AI Features
                                |
                                v
                       TextGenerationService
                                |
              +-----------------+----------------+
              |                 |                |
              v                 v                v
         AI Enabled?        Timeout          Retry/Backoff
              |                 |                |
              +-----------------+----------------+
                                |
                                v
                           AI Provider
                                |
                                v
                          External Model
                                |
                                v
                         AI Response
                                |
                        +-------+-------+
                        |               |
                     Parsing          Zod
                        |            Validation
                        +-------+-------+
                                |
                                v
                         Valid AI Result
```

---

# 46. Current vs Future Reliability

| Capability                 | Current MVP            | Future                        |
| -------------------------- | ---------------------- | ----------------------------- |
| Feature flag               | Yes                    | Continue                      |
| Input-size limit           | Yes                    | Tune based on usage           |
| Timeout                    | Yes                    | Improve per-feature if needed |
| AbortSignal                | Yes                    | Continue                      |
| Retry                      | Yes                    | Improve policy                |
| Exponential backoff        | Yes                    | Add jitter if needed          |
| Response validation        | Yes                    | Continue                      |
| Provider abstraction       | Yes                    | Add providers if justified    |
| Mock provider              | Yes                    | Continue                      |
| Dedicated AI rate limiting | No                     | Recommended                   |
| Circuit breaker            | No                     | Consider at scale             |
| Provider fallback          | No                     | Consider if justified         |
| AI metrics                 | Basic logs             | Dedicated metrics             |
| Token/cost tracking        | No                     | Consider later                |
| Async AI worker            | No for current feature | Planned for semantic search   |
| Dead-letter handling       | No                     | Relevant for async AI         |
| Distributed tracing        | No                     | Future observability          |

---

# 47. Important Current Limitations

The reliability implementation is intentionally MVP-level.

The following should **not** be claimed as implemented:

### Dedicated AI rate limiting

Not currently attached to the AI route.

### Circuit breaker

Not implemented.

### Automatic provider fallback

Not implemented.

### AI usage/cost database

Not implemented.

### Dedicated AI metrics system

Not implemented.

### Async Post Assistant

Not implemented.

### Dead-letter queue for AI requests

Not implemented.

These can be introduced only when the system's actual requirements justify their complexity.

---

# 48. Reliability Design Decision

The current reliability strategy follows a simple principle:

> **Make synchronous AI calls bounded and recoverable without making AI a critical dependency of the core application.**

This results in:

```text id="j2p7w4"
Bounded
  |
  +--> Timeout

Recoverable
  |
  +--> Retry
  +--> Backoff

Safe
  |
  +--> Validation
  +--> Error normalization

Optional
  |
  +--> AI_ENABLED

Testable
  |
  +--> Mock Provider
```

This provides a reasonable reliability baseline for the current MVP.

---

# 49. Interview Explanation

A concise SDE interview explanation could be:

> "I treated the AI provider as an unreliable external dependency. For synchronous AI calls, I put reliability logic in a shared TextGenerationService instead of duplicating it across features. Every request has a configurable timeout using AbortController. We retry only transient failures such as 408, 429 and 5xx, with exponential backoff and a configurable retry limit. Timeouts are not retried in the current MVP because repeated long waits would make synchronous requests unpredictable. On the response side, we parse and validate the model output with Zod because provider success doesn't guarantee valid application data. AI is also feature-flagged, so core WriteSpace functionality doesn't depend on provider availability. For future asynchronous features like semantic-search embeddings, I plan to reuse the existing BullMQ infrastructure and apply worker-level retry and failure handling."

---

# 50. Likely Interview Questions

## Q1. How did you make the AI integration reliable?

**Concept:** External dependency reliability

Mention:

- timeout,
- AbortController,
- retry,
- exponential backoff,
- retry limit,
- response validation,
- error normalization,
- feature flag.

---

## Q2. What happens if Gemini is down?

**Concept:** Graceful degradation

Answer:

The AI request fails through the AI error layer, but core WriteSpace functionality remains independent of the AI provider.

The application can also disable AI using `AI_ENABLED`.

---

## Q3. Why don't you make the AI call part of post creation?

**Concept:** Transaction boundaries / failure isolation

Answer:

The AI suggestion is optional.

Making post creation depend on AI would mean:

```text
Database operation
     +
AI provider
```

could cause the entire post creation workflow to fail because of an unrelated external dependency.

The current architecture keeps them separate.

---

## Q4. Why exponential backoff?

**Concept:** Distributed systems

Answer:

Immediate retries can amplify provider problems and create retry storms.

Exponential backoff spaces retries and gives the provider time to recover.

---

## Q5. Why not retry timeouts?

**Concept:** Latency management

Answer:

The current Post Assistant is synchronous.

Retrying a timeout could multiply the user's waiting time.

Therefore timeout is treated as a terminal failure for the current request.

---

## Q6. How would you improve reliability at larger scale?

**Concept:** Scalability / resilience

Possible answer:

- AI-specific rate limiting,
- exponential backoff with jitter,
- circuit breaker,
- provider fallback,
- async workers,
- job retry policies,
- dead-letter queues,
- metrics,
- tracing,
- usage/cost monitoring.

---

## Q7. How would Semantic Search change your reliability design?

**Concept:** Asynchronous architecture

Answer:

Embedding generation can be moved to BullMQ workers.

The user-facing request would not have to wait for the embedding provider.

Failed jobs could be retried independently with backoff and eventually moved to a failure/dead-letter workflow.

---

# 51. Final Reliability Checklist

Before introducing a new AI feature, verify:

```text id="s4n8x1"
[ ] AI can be disabled
[ ] Input size is bounded
[ ] Provider call has a timeout
[ ] AbortSignal is propagated
[ ] Retryable errors are explicitly defined
[ ] Retry count is bounded
[ ] Backoff is used
[ ] AI output is parsed
[ ] AI output is schema-validated
[ ] Provider errors are normalized
[ ] Errors are logged
[ ] Failure behavior is tested
[ ] Mock provider can be used in tests
[ ] AI failure does not unnecessarily break core functionality
[ ] Rate limiting requirement has been evaluated
[ ] Sync vs async execution has been intentionally chosen
```

---

# 52. Summary

The current WriteSpace AI reliability architecture is intentionally simple but structured.

The main reliability mechanisms are:

1. **Feature flagging** through `AI_ENABLED`.
2. **Input-size limits** before provider calls.
3. **Configurable timeouts** for external AI requests.
4. **AbortController** for request cancellation.
5. **Controlled retries** for transient provider failures.
6. **Exponential backoff** between retries.
7. **Bounded retry count** through `AI_MAX_RETRIES`.
8. **Response parsing and Zod validation** for AI output.
9. **Provider error normalization** through application-level errors.
10. **Centralized reliability logic** inside `TextGenerationService`.
11. **Mock-provider testing** without depending on real AI APIs.
12. **Graceful degradation**, because core WriteSpace functionality does not depend on AI.

The architecture intentionally avoids premature complexity.

There is currently no:

- AI-specific rate limiter,
- circuit breaker,
- provider fallback,
- AI usage database,
- dedicated AI metrics system,
- asynchronous Post Assistant,
- dead-letter workflow.

These are future options rather than current implementation.

The central reliability principle is:

> **AI should improve WriteSpace without becoming a single point of failure for WriteSpace's core functionality.**
