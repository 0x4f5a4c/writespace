# AI Testing

## 1. Purpose

The AI subsystem depends on an external provider, which introduces a testing challenge.

Calling the real AI provider for every test would make the test suite:

- dependent on network availability,
- dependent on provider availability,
- slower,
- nondeterministic,
- potentially quota-consuming,
- difficult to reproduce.

WriteSpace therefore separates AI testing into different layers.

The current testing strategy primarily uses:

1. **Unit tests with mocked AI providers**
2. **Service-level tests for reliability behavior**
3. **Feature-level tests for AI response parsing and validation**
4. **Manual/real-provider verification for confirming the Gemini integration**

The main principle is:

> **Business logic and reliability behavior should be testable without depending on the real AI provider.**

---

# 2. Testing Architecture

The current AI testing structure can be understood as:

```text
                    AI Tests
                       |
          +------------+------------+
          |                         |
          v                         v
    AIService Tests       TextGenerationService Tests
          |                         |
          v                         v
   Mock Text Service          Mock AI Provider
          |                         |
          v                         v
   Response Parsing          Retry / Timeout /
   + Zod Validation          Error Handling
```

The real Gemini API is kept outside the normal unit-test path.

---

# 3. Why Mock the AI Provider?

The AI provider is an external dependency.

If a unit test directly called Gemini:

```text
Test
 |
 v
Gemini API
 |
 v
Model
 |
 v
Response
```

the result could depend on external conditions.

For example:

- Gemini could be temporarily unavailable.
- The model could return a different answer.
- The network could fail.
- Provider rate limits could be reached.
- The request could take several seconds.
- The provider could change behavior.

That would make the test suite unreliable.

Instead, WriteSpace uses the provider abstraction:

```text
AIService
    |
    v
TextGenerationService
    |
    v
AIProvider
    |
    +---- GeminiProvider
    |
    +---- MockAIProvider
```

Tests can inject a controlled implementation.

---

# 4. Mock Provider

The current mock provider implements the same `AIProvider` interface as Gemini:

```ts id="4r9k2m"
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

The important point is not the particular mock response.

The important part is that it satisfies the same interface:

```ts id="j6x3p8"
AIProvider;
```

as:

```ts id="m1v7q4"
GeminiProvider;
```

This allows the rest of the AI architecture to be tested without knowing which provider is being used.

---

# 5. Dependency Injection for Testing

`TextGenerationService` accepts an optional provider:

```ts id="p8q4w1"
constructor(provider: AIProvider = createAIProvider()) {
  this.provider = provider;
}
```

This is particularly useful for testing.

In production:

```text id="k5v2n7"
new TextGenerationService()
        |
        v
createAIProvider()
        |
        v
GeminiProvider
```

In a test:

```text id="x3m8q6"
new TextGenerationService(mockProvider)
        |
        v
Mock Provider
```

The test can therefore control exactly how the provider behaves.

---

# 6. Why Dependency Injection Matters Here

Without dependency injection, the service would always create the real provider:

```text id="z7q2c4"
TextGenerationService
        |
        v
new GeminiProvider()
```

That would make it much harder to test:

- timeouts,
- retries,
- provider failures,
- malformed responses.

With dependency injection:

```text id="w4p9m2"
TextGenerationService
        |
        v
AIProvider interface
        |
        +---- Real provider
        |
        +---- Mock provider
        |
        +---- Test-specific fake
```

Tests can simulate conditions that may be difficult to reproduce reliably with a real provider.

---

# 7. Current AI Test Suites

The current AI implementation has two important unit-test areas:

```text id="c8x5n1"
test/
└── unit/
    └── modules/
        └── ai/
            ├── ai.service.test.ts
            └── ...
```

The exact surrounding test-directory structure should follow the repository's existing test organization.

The important conceptual separation is:

### `AIService`

Tests feature-level AI behavior.

### `TextGenerationService`

Tests provider communication reliability behavior.

---

# 8. AIService Testing

The current `AIService` tests cover four important scenarios:

1. Valid JSON response
2. Invalid JSON response
3. Valid JSON with an invalid schema
4. Propagation of `TextGenerationService` errors

These tests focus on what happens after the text-generation layer returns a result.

---

# 9. AIService Test — Valid JSON

The successful path should verify that valid AI output is:

1. parsed,
2. validated,
3. returned in the expected structure.

The expected model output has this shape:

```json id="n6t2v8"
{
  "suggestedTitle": "string",
  "summary": "string",
  "topics": ["string"]
}
```

The test verifies that the service produces the corresponding `PostAssistantResponse`.

The purpose of this test is to ensure that the normal AI feature flow works independently of Gemini.

---

# 10. AIService Test — Invalid JSON

The AI service explicitly calls:

```ts id="v4k8p2"
JSON.parse(text);
```

Therefore, malformed model output must be tested.

A test can provide a response that is not valid JSON.

The expected behavior is:

```text id="j5m1q7"
Invalid AI text
      |
      v
JSON.parse()
      |
      X
      |
      v
AIResponseParseError
```

The test verifies that malformed model output does not silently reach the client.

---

# 11. Why Invalid JSON Must Be Tested

Prompt instructions cannot guarantee that a model will always produce exactly the requested format.

Even though the Post Assistant asks the model:

```text id="s2q6m8"
Return ONLY valid JSON
```

the application should not assume that the model will always comply.

Therefore the code treats model output as untrusted external data.

The test protects this behavior from future regressions.

---

# 12. AIService Test — Valid JSON, Invalid Schema

A second important failure case is:

> The response is valid JSON but does not match the application's expected structure.

For example:

```json id="g8x3m1"
{
  "title": "Redis Caching"
}
```

This passes:

```ts id="k2w6p9"
JSON.parse(...)
```

but fails:

```ts id="q5n8r3"
postAssistantResponseSchema.safeParse(...)
```

The expected result is:

```text id="b1v7m4"
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

This verifies that the application validates the semantic structure of AI output, not merely its JSON syntax.

---

# 13. AIService Test — Error Propagation

The fourth current `AIService` test verifies that errors from `TextGenerationService` are propagated.

The feature service should not silently convert or hide lower-level reliability failures.

For example:

```text id="x8m4q2"
TextGenerationService
        |
        X
        |
        v
AIProviderError / AITimeoutError
        |
        v
AIService
        |
        v
Propagate
```

This keeps responsibility separated between the layers.

`TextGenerationService` owns provider reliability.

`AIService` owns feature-specific AI behavior.

---

# 14. AIService Testing Responsibility

The current AI service tests answer:

> "Given that the text-generation layer returned this result/error, does the Post Assistant correctly process it?"

They do **not** need to test:

- Gemini's internal behavior,
- network behavior,
- retry implementation,
- timeout implementation.

Those belong to the lower-level service tests.

This keeps tests focused.

---

# 15. TextGenerationService Testing

The `TextGenerationService` contains most of the AI reliability logic.

The current test suite covers six important cases:

1. Successful generation
2. AI disabled
3. Unexpected provider error normalization
4. Timeout
5. Retry on transient `503`
6. No retry for non-transient errors

This test suite verifies the reliability boundary independently from the real provider.

---

# 16. TextGenerationService Test — Successful Generation

The first test verifies the normal path.

Conceptually:

```text id="h7m3p9"
Mock Provider
     |
     v
Successful response
     |
     v
TextGenerationService
     |
     v
Return response
```

The purpose is to verify that the service does not unnecessarily modify a successful provider response.

It establishes the baseline behavior before testing failure scenarios.

---

# 17. TextGenerationService Test — AI Disabled

The service checks:

```ts id="r4q8w2"
if (!env.AI_ENABLED) {
  throw new AIDisabledError();
}
```

The test verifies that when AI is disabled:

```text id="f6k1n5"
AI_ENABLED=false
       |
       v
TextGenerationService
       |
       v
AIDisabledError
```

and the provider should not need to be contacted.

This test protects the feature-flag behavior.

---

# 18. TextGenerationService Test — Unexpected Provider Error

The provider may throw an unexpected error that does not match the expected retry conditions.

The service eventually normalizes unexpected failures into:

```ts id="m2x7c4"
AIProviderError;
```

The test verifies that arbitrary provider failures do not leak directly through the service.

The intended behavior is:

```text id="p8v3n6"
Provider exception
      |
      v
TextGenerationService
      |
      v
AIProviderError
```

This keeps the service's external error contract predictable.

---

# 19. TextGenerationService Test — Timeout

Timeout handling is particularly important because the service uses `AbortController`.

The current timeout flow is:

```ts id="q7m1x4"
const controller = new AbortController();

const timeout = setTimeout(() => {
  controller.abort();
}, env.AI_TIMEOUT_MS);
```

The provider receives:

```ts id="n5c8r2"
signal: controller.signal;
```

The test uses a fake provider that respects the abort signal.

This allows the test to simulate a provider that does not complete before the configured timeout.

Expected result:

```text id="w3k6p9"
Provider
   |
   | does not complete
   |
   v
AbortController
   |
   v
AITimeoutError
```

---

# 20. Why the Timeout Test Uses a Fake Provider

A real network timeout would make tests:

- slow,
- flaky,
- dependent on network conditions.

Instead, the test provider can deliberately wait for the abort signal.

Conceptually:

```text id="s1n7v5"
Test Provider
     |
     | waiting...
     |
     | receives AbortSignal
     v
Reject/stop
     |
     v
TextGenerationService
     |
     v
AITimeoutError
```

This tests the application's timeout logic rather than the network.

---

# 21. AbortSignal as a Test Boundary

The provider interface includes:

```ts id="g8r2m5"
signal?: AbortSignal;
```

This makes timeout behavior testable without knowing the implementation details of Gemini.

The test verifies the contract:

```text id="x6p1q9"
TextGenerationService
        |
        | AbortSignal
        v
AIProvider
        |
        v
Test Provider
```

This is another benefit of the provider abstraction.

---

# 22. TextGenerationService Test — Retry on 503

A provider `503` is classified as transient:

```ts id="k4m9v2"
if (status >= 500 && status <= 599) {
  return true;
}
```

The test simulates a provider that initially fails with `503`.

The expected behavior is:

```text id="y7q3n8"
Attempt 1
   |
   X 503
   |
   v
Retry
   |
   v
Attempt 2
   |
   v
Success
```

This verifies that retry behavior actually occurs rather than merely existing in code.

---

# 23. Why Retry Tests Are Important

Retry logic is easy to get subtly wrong.

Potential bugs include:

- retrying non-retryable errors,
- retrying too many times,
- never retrying,
- incorrect attempt counting,
- incorrect backoff behavior,
- retrying after a timeout,
- returning the wrong error after retries are exhausted.

A dedicated test provides protection against these regressions.

---

# 24. TextGenerationService Test — No Retry for Non-Transient Error

The current implementation only retries:

```text id="z6c2m8"
408
429
5xx
```

The test verifies that a non-transient provider error is not retried.

Conceptually:

```text id="p3n8x5"
Provider
   |
   X
Non-retryable error
   |
   v
TextGenerationService
   |
   X
No retry
   |
   v
Failure
```

This is important because unnecessary retries can:

- increase latency,
- increase provider load,
- consume quota,
- hide deterministic failures.

---

# 25. Test Matrix

The current AI unit tests can be summarized as:

| Layer                 | Scenario                     | Expected Result               |
| --------------------- | ---------------------------- | ----------------------------- |
| AIService             | Valid JSON                   | Valid `PostAssistantResponse` |
| AIService             | Invalid JSON                 | `AIResponseParseError`        |
| AIService             | Wrong JSON schema            | `AIResponseParseError`        |
| AIService             | Text-generation error        | Error propagates              |
| TextGenerationService | Successful provider response | Response returned             |
| TextGenerationService | AI disabled                  | `AIDisabledError`             |
| TextGenerationService | Unexpected provider error    | `AIProviderError`             |
| TextGenerationService | Timeout                      | `AITimeoutError`              |
| TextGenerationService | Transient `503`              | Retry                         |
| TextGenerationService | Non-transient error          | No retry                      |

This gives the current implementation coverage across both the feature and reliability layers.

---

# 26. Testing the Provider Layer

The Gemini provider itself is intentionally thin.

Its primary responsibility is translating the generic interface into the Gemini SDK call:

```ts id="m5r8c2"
this.client.models.generateContent({
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

The most important behavior of the provider is therefore integration with the actual SDK.

That is different from testing `TextGenerationService`.

---

# 27. Unit Tests vs Real Provider Verification

The AI system has two different testing boundaries.

### Unit testing

```text id="q1v5m7"
Application
   |
   v
Mock Provider
```

Used for:

- business logic,
- retry,
- timeout,
- error handling,
- response parsing,
- validation.

### Real provider verification

```text id="x8m2r6"
Application
   |
   v
GeminiProvider
   |
   v
Gemini API
```

Used to confirm:

- credentials work,
- SDK integration works,
- selected model is available,
- request format is accepted,
- actual endpoint returns expected data.

These should not be treated as the same type of test.

---

# 28. Manual API Verification

The current implementation was also verified through the actual endpoint:

```text id="w7k3p9"
POST /api/v1/ai/post-assistant
```

with a request similar to:

```json id="n2c8x5"
{
  "title": "Understanding Redis Caching",
  "content": "Redis is an in-memory data store commonly used for caching frequently accessed data. It can improve application performance by reducing repeated database queries.",
  "instruction": "Make the suggestions suitable for backend developers."
}
```

The actual provider successfully returned structured suggestions.

This confirms that the full path works:

```text id="r4m9q1"
Postman
   |
   v
Express Route
   |
   v
Controller
   |
   v
AIService
   |
   v
TextGenerationService
   |
   v
GeminiProvider
   |
   v
Gemini API
   |
   v
Response
```

---

# 29. Why Real Provider Tests Should Be Separate

A real provider test is useful, but it should not normally be required for every test run.

Reasons include:

### Network dependency

The test requires internet connectivity.

### Provider availability

The provider may be temporarily unavailable.

### Model availability

The configured model can change availability.

### Quota

Repeated calls can consume provider quota.

### Latency

Real model calls are much slower than local unit tests.

### Nondeterminism

AI responses can vary.

Therefore:

> Real-provider verification is an integration/verification activity, while unit tests should remain deterministic.

---

# 30. Testing AI Output Deterministically

One of the major challenges of AI testing is that generated text can vary.

For example, two successful model calls could produce:

```text id="a8v2k6"
Mastering Redis Caching
```

and:

```text id="m4q7x1"
Optimizing Backend Performance with Redis
```

Both may be valid.

Therefore, tests should not generally assert exact natural-language output from a real model.

Instead, tests should verify deterministic contracts such as:

```text id="c5n8r2"
- JSON is parseable
- required fields exist
- types are correct
- arrays contain strings
- service errors are handled correctly
```

The current Zod response schema is useful for this reason.

---

# 31. What Should Be Mocked?

The current testing boundary suggests:

### Mock

- external AI provider,
- provider failures,
- provider timeout,
- transient status codes,
- malformed provider output.

### Test directly

- `AIService`,
- `TextGenerationService`,
- DTO schemas,
- response parsing,
- retry classification.

### Verify separately

- actual Gemini SDK integration,
- API credentials,
- actual model availability,
- real endpoint behavior.

This keeps the test suite focused.

---

# 32. Testing the Feature Flag

The AI feature flag should be treated as a testable operational behavior.

Current configuration:

```env id="q3x7m1"
AI_ENABLED=true
```

The test should also cover:

```env id="n8c2p5"
AI_ENABLED=false
```

Expected behavior:

```text id="v4m9x2"
AI request
   |
   v
Feature flag
   |
   X
AI provider not called
   |
   v
AIDisabledError
```

This ensures that disabling AI actually prevents provider calls.

---

# 33. Testing Retry Count

The retry implementation has a configurable maximum:

```env id="j5r8q2"
AI_MAX_RETRIES=2
```

A useful test verifies that the provider is not called indefinitely.

Conceptually:

```text id="x7m3c9"
Initial call
   |
   X
Retry #1
   |
   X
Retry #2
   |
   X
Stop
```

The important assertion is not only that a retry occurs, but also that retries eventually stop.

---

# 34. Testing Non-Retryable Errors

The opposite boundary should also be tested.

For example:

```text id="h6q2w8"
Provider
   |
   X
400
   |
   v
TextGenerationService
   |
   v
No retry
```

A test can track provider invocation count.

Expected:

```text id="m1v8p4"
Provider calls = 1
```

rather than:

```text id="r3x7k2"
Provider calls > 1
```

This protects against accidental broad retry logic.

---

# 35. Testing Error Propagation

The AI architecture intentionally has layered responsibility.

Tests should therefore verify that errors remain correctly classified while moving through layers.

Example:

```text id="s8c2n6"
Provider
   |
   v
Transient error
   |
   v
TextGenerationService
   |
   v
Retry
   |
   v
Final failure
   |
   v
AIProviderError
   |
   v
AIService
   |
   v
Controller / global error handler
```

The feature layer should not accidentally turn a timeout into a successful response or silently swallow a provider failure.

---

# 36. Testing Response Schema Validation

The response schema is:

```ts id="p7x4m2"
export const postAssistantResponseSchema = z.object({
  suggestedTitle: z.string().min(1),
  summary: z.string().min(1),
  topics: z.array(z.string()).min(1),
});
```

Tests should verify both:

### Valid structure

```json id="z2m8q5"
{
  "suggestedTitle": "Redis Caching",
  "summary": "A summary",
  "topics": ["Redis", "Caching"]
}
```

### Invalid structure

```json id="y5c1n7"
{
  "suggestedTitle": "Redis Caching"
}
```

The second should fail validation.

This protects the application contract from changes in AI output.

---

# 37. Testing Input Validation

The Post Assistant request schema validates:

```ts id="n4k8q2"
title;
content;
instruction;
```

with constraints such as:

```text id="m9x3v6"
title       -> optional, max 300
content     -> required, max AI_MAX_INPUT_CHARS
instruction -> optional, max 1000
```

The controller performs:

```ts id="c6p2w8"
postAssistantRequestSchema.safeParse(req.body);
```

Invalid requests return:

```text id="q7m1n5"
400 Bad Request
```

These tests protect the boundary before an expensive provider call is made.

---

# 38. Testing Should Avoid Real API Keys

Unit tests should not require:

```text id="f3r8m2"
GEMINI_API_KEY
```

to be valid.

The mock provider allows tests to run without depending on secrets.

This also prevents accidental credential exposure through test configuration.

The real API key belongs only in the appropriate local/deployment environment.

---

# 39. Test Isolation

Each unit test should be independent.

For AI reliability tests, this means:

- provider state should not leak between tests,
- retry counters should be reset,
- mocked provider behavior should be controlled per test,
- environment configuration should be restored after changes,
- tests should not depend on execution order.

This is especially important for tests involving:

```text id="g2m7x4"
AI_ENABLED
AI_MAX_RETRIES
AI_TIMEOUT_MS
```

because configuration affects service behavior.

---

# 40. Testing Timers

The retry and timeout implementations use timers:

```ts id="k8v2m6"
setTimeout(...)
```

Therefore timer behavior should be tested carefully.

For example:

```text id="p4x7c1"
Timeout test
    |
    v
AbortController
    |
    v
AITimeoutError
```

and:

```text id="r9m3q5"
Retry test
    |
    v
Backoff delay
    |
    v
Retry
```

Fake timers can be useful when expanding the test suite because they avoid making the test suite actually wait for seconds.

The current tests already cover the important timeout/retry behavior; fake timers are a potential refinement depending on the test implementation.

---

# 41. Current Test Coverage Summary

The current implementation has meaningful coverage around the most important AI failure boundaries.

### `AIService`

```text id="u3n8p2"
[✓] Valid JSON
[✓] Invalid JSON
[✓] Invalid response schema
[✓] TextGenerationService error propagation
```

### `TextGenerationService`

```text id="x5m1q7"
[✓] Successful generation
[✓] AI disabled
[✓] Unexpected provider error
[✓] Timeout
[✓] Retry on 503
[✓] No retry on non-transient error
```

This is a strong baseline for the current MVP.

---

# 42. Current Testing Boundaries

It is useful to explicitly define what the current tests do and do not prove.

### Unit tests prove

- service logic behaves correctly,
- retry classification works,
- timeout handling works,
- errors are normalized,
- AI output is validated,
- feature logic works with controlled dependencies.

### Real provider verification proves

- Gemini SDK integration works,
- credentials are accepted,
- selected model is usable,
- actual request/response flow works.

### Unit tests do not prove

- Gemini will always be available,
- the model will always return the same content,
- provider latency will remain constant,
- production traffic behavior is correct.

Those require different forms of testing and observability.

---

# 43. Future Integration Tests

As the AI subsystem grows, integration tests could verify:

```text id="q8v3m1"
HTTP Request
    |
    v
Express Route
    |
    v
Controller
    |
    v
AIService
    |
    v
TextGenerationService
    |
    v
Test Provider
```

This would test more of the application stack without requiring the real Gemini service.

For example:

```text
POST /api/v1/ai/post-assistant
```

could be tested with a deterministic test provider.

---

# 44. Future End-to-End Tests

A true end-to-end test could eventually verify:

```text id="m4x9p7"
Client
  |
  v
HTTP API
  |
  v
AI Feature
  |
  v
Provider
```

However, real-provider E2E tests should be used selectively because of:

- cost/quota,
- latency,
- nondeterministic output,
- external availability.

They are better suited for controlled verification rather than every CI run.

---

# 45. Future Semantic Search Testing

Semantic Search will introduce additional testing requirements.

The future flow is expected to be:

```text id="r6n2x8"
Post
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

Testing will then need to cover:

### Job creation

Verify an embedding job is queued.

### Worker processing

Verify the worker consumes the job.

### Provider failure

Verify transient failures trigger retries.

### Job exhaustion

Verify permanently failing jobs are handled.

### Idempotency

Verify the same post does not produce conflicting duplicate embeddings.

### Vector persistence

Verify embeddings are stored correctly.

These belong to the future Semantic Search testing strategy and are not currently implemented.

---

# 46. Testing Reliability vs Testing AI Quality

These are different problems.

### Reliability testing

Asks:

> "Does the application behave correctly when the provider succeeds or fails?"

Examples:

- timeout,
- retry,
- provider error,
- malformed response.

### AI quality testing

Asks:

> "Are the generated suggestions actually useful?"

Examples:

- title quality,
- summary accuracy,
- topic relevance.

The current implementation primarily tests **software correctness and reliability**, not sophisticated model-quality evaluation.

---

# 47. AI Quality Evaluation — Future

Once AI features become more important, an evaluation dataset could be introduced.

For example:

```text id="x7m4p2"
Input Blog
    |
    +--> Expected characteristics
    |
    +--> Actual AI response
    |
    v
Evaluation
```

Metrics could eventually include:

- structured-output success rate,
- relevance,
- factual consistency,
- summary quality,
- topic precision.

This is future work and is not required for the current MVP.

---

# 48. Testing Security Boundaries

AI tests should eventually cover that sensitive application information is not accidentally included in prompts.

For example, the AI feature should not send:

- passwords,
- authentication tokens,
- secret API keys.

The current Post Assistant accepts:

```text id="q3v8m6"
title
content
instruction
```

rather than authentication secrets.

As future AI features access more application data, prompt construction should be tested for data-leak boundaries.

---

# 49. Test Design Principles

The current AI testing strategy follows several principles.

### 1. Test behavior, not implementation details

Tests should verify observable behavior rather than tightly coupling themselves to internal code structure.

### 2. Keep external dependencies mocked

The real AI provider should not be required for unit tests.

### 3. Test failure paths explicitly

AI failures are expected possibilities, not exceptional test cases.

### 4. Keep tests deterministic

The same input should produce the same test result.

### 5. Separate feature tests from infrastructure tests

`AIService` should not need to know how retries work.

`TextGenerationService` should not need to know what a blog summary means.

### 6. Test contracts

The provider interface and response schema define useful contracts that can be tested independently.

---

# 50. Recommended AI Test Pyramid

For the current and future architecture:

```text id="n8q2v6"
                 /\
                /  \
               / E2E\
              /------\
             / Real   \
            / Provider \
           /------------\
          / Integration  \
         / Test Provider \
        /-----------------\
       /     Unit Tests    \
      /---------------------\
```

The majority of tests should remain unit tests.

A smaller number of integration tests should verify the application wiring.

A very small number of real-provider tests should verify the external integration.

---

# 51. Current Test Pyramid

For the current MVP:

```text id="w4m7p1"
              Real Gemini
             Verification
                  ▲
                  |
          Integration Boundary
                  ▲
                  |
          Unit Tests
       +------------------+
       | AIService        |
       | TextGeneration   |
       | DTO validation   |
       | Error handling   |
       +------------------+
```

This is appropriate because most behavior can be verified without the network.

---

# 52. Why This Testing Strategy Fits the MVP

The current AI functionality is small:

```text id="c5n8r2"
Post Assistant
```

The project therefore does not need a large AI evaluation platform yet.

The most important risks are currently:

- provider failures,
- timeout behavior,
- retry behavior,
- malformed model output,
- invalid structured output,
- configuration failures.

The existing unit tests target these risks directly.

This gives good engineering value without introducing unnecessary testing infrastructure.

---

# 53. Current vs Future Testing

| Testing Capability               | Current                           | Future                      |
| -------------------------------- | --------------------------------- | --------------------------- |
| AIService unit tests             | Implemented                       | Expand as features grow     |
| TextGenerationService unit tests | Implemented                       | Expand edge cases           |
| Mock provider                    | Implemented                       | Continue                    |
| Timeout testing                  | Implemented                       | More edge cases             |
| Retry testing                    | Implemented                       | Backoff/jitter tests        |
| Response schema tests            | Implemented                       | Continue                    |
| Real Gemini verification         | Performed manually                | Controlled integration test |
| HTTP integration tests           | Not documented as current AI test | Add                         |
| E2E AI tests                     | Not implemented                   | Selective                   |
| AI quality evaluation            | Not implemented                   | Later                       |
| Semantic Search worker tests     | Not applicable yet                | Later                       |
| Embedding tests                  | Not applicable yet                | Later                       |
| AI metrics tests                 | Not implemented                   | Later                       |

---

# 54. Interview Explanation

A concise interview explanation could be:

> "I avoid calling the real Gemini API from normal unit tests because AI providers are external, slow, rate-limited and nondeterministic. The AI code is designed around an `AIProvider` interface, so I inject a mock provider into `TextGenerationService`. I have separate tests for the feature layer and the reliability layer. The `AIService` tests cover valid JSON, malformed JSON, invalid response schemas and error propagation. The `TextGenerationService` tests cover successful calls, AI-disabled behavior, timeout, transient 503 retries, non-retryable errors and provider-error normalization. For timeout testing, I use a provider that respects `AbortSignal`, so the test can deterministically simulate cancellation without waiting for a real network timeout. Real Gemini calls are treated as integration/manual verification rather than the foundation of the unit-test suite."

---

# 55. Likely Interview Questions

## Q1. Why don't you call Gemini in your unit tests?

**Concept:** Unit testing / external dependencies

Because real provider calls are:

- slow,
- nondeterministic,
- network-dependent,
- quota-dependent.

The provider interface allows deterministic mocks.

---

## Q2. How did you test timeout behavior?

**Concept:** Async testing / cancellation

Inject a provider that respects the `AbortSignal`.

When the configured timeout triggers `AbortController.abort()`, the test verifies that the service converts it into `AITimeoutError`.

---

## Q3. How did you test retry behavior?

**Concept:** Resilience testing

Use a mock provider that initially throws a transient `503` and then succeeds.

Verify that the service retries rather than immediately failing.

---

## Q4. How do you know you aren't retrying errors that shouldn't be retried?

**Concept:** Retry classification

Use a test provider that throws a non-transient status and verify that the provider is called only once.

---

## Q5. How do you test AI output if the model is nondeterministic?

**Concept:** AI testing

Do not assert exact natural-language output in unit tests.

Instead, test deterministic contracts:

- valid JSON,
- expected fields,
- correct data types,
- schema validation,
- error handling.

---

## Q6. What would you test for Semantic Search?

**Concept:** Async systems / background jobs

Mention:

- job creation,
- worker processing,
- provider failures,
- retries,
- idempotency,
- embedding persistence,
- vector search behavior.

---

## Q7. What's the difference between AI quality testing and reliability testing?

**Concept:** AI evaluation

Reliability asks whether the software behaves correctly around the AI provider.

Quality evaluation asks whether the generated content is actually useful, relevant and accurate.

The current implementation primarily addresses reliability and structured correctness.

---

# 56. Testing Checklist

For every new AI feature, verify:

```text id="v5m8q2"
[ ] Happy path is tested
[ ] Provider is mocked for unit tests
[ ] Provider failure is tested
[ ] Timeout is tested where applicable
[ ] Retry behavior is tested where applicable
[ ] Non-retryable errors are tested
[ ] Response parsing is tested
[ ] Response schema is tested
[ ] Invalid input is tested
[ ] Feature-disabled behavior is tested
[ ] Errors are propagated correctly
[ ] Real provider verification is separate from unit tests
[ ] Secrets are not required by unit tests
[ ] Tests are deterministic
[ ] External network is not required for normal unit tests
```

For asynchronous AI features, additionally:

```text id="j2q7n4"
[ ] Job creation
[ ] Worker execution
[ ] Job retry
[ ] Job failure
[ ] Idempotency
[ ] Persistence
[ ] Recovery after worker restart
```

---

# 57. Final Testing Strategy

The current WriteSpace AI testing strategy can be summarized as:

```text id="m6r1x8"
                 AI Testing
                     |
       +-------------+-------------+
       |                           |
       v                           v
   Unit Tests               Real Provider
       |                    Verification
       |                           |
       v                           v
 Mock Provider                Gemini API
       |                           |
       +-------------+-------------+
                     |
                     v
              Confidence
```

The unit tests provide deterministic coverage for application behavior.

The real-provider verification confirms that the external integration works.

Neither replaces the other.

---

# 58. Summary

The WriteSpace AI testing strategy is built around the provider abstraction and dependency injection.

The current implementation tests:

1. Successful AI generation.
2. AI-disabled behavior.
3. Provider error normalization.
4. Provider timeouts.
5. Retry behavior for transient `503` failures.
6. No retry for non-transient errors.
7. Valid AI JSON responses.
8. Malformed JSON responses.
9. Invalid response schemas.
10. Error propagation between AI layers.

The most important architectural decision is that normal unit tests do not depend on Gemini.

Instead:

```text
Application
    |
    v
AIProvider Interface
    |
    +---- Mock Provider -> Unit Tests
    |
    +---- Gemini Provider -> Real Verification
```

This gives the AI subsystem deterministic tests while still allowing the actual provider integration to be verified separately.

As the AI subsystem expands, particularly with Semantic Search and asynchronous embedding generation, the testing strategy can evolve to include:

- HTTP integration tests,
- worker tests,
- job retry tests,
- idempotency tests,
- vector-storage tests,
- controlled real-provider tests,
- AI-quality evaluation.

For the current MVP, however, the existing unit-test strategy provides the most important protection: **AI failures and malformed model output should not silently become application failures or incorrect successful responses.**
