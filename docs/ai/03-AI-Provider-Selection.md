# AI Provider Selection

## 1. Purpose

This document explains why Google Gemini was selected as the initial AI provider for WriteSpace, how the provider was evaluated, the problems encountered during integration, and why the current development model is `gemini-3.5-flash-lite`.

The goal was not to permanently commit WriteSpace to a single AI provider.

Instead, the AI architecture was designed around a provider abstraction so that the initial provider can be replaced or additional providers can be introduced later without changing the AI feature logic.

---

# 2. Provider Selection Requirements

Before selecting a provider, the following requirements were considered.

## 2.1 Low Development Cost

WriteSpace is currently a college/SDE portfolio project.

The initial AI implementation therefore needed to be usable during development without introducing unnecessary API costs.

The initial goal was:

```text
Development AI usage
        ↓
Minimal / free-tier cost
        ↓
Avoid unnecessary paid infrastructure
```

The provider's current free-tier availability and quotas can change over time, so these should be verified against the provider's current official documentation whenever deployment or long-term usage is considered.

---

## 2.2 API Accessibility

The provider needed to expose an API that could be called from the WriteSpace Node.js/TypeScript backend.

The provider should support normal application-server usage rather than requiring the AI logic to run directly in the frontend.

The desired flow was:

```text
WriteSpace Backend
       ↓
AI Provider SDK/API
       ↓
AI Model
       ↓
Generated Response
```

---

## 2.3 Node.js / TypeScript Support

WriteSpace's backend is built using Node.js and TypeScript.

Therefore, the provider needed to have a usable JavaScript/TypeScript SDK.

The selected Gemini integration uses Google's current JavaScript SDK:

```text
@google/genai
```

The provider-specific SDK code is isolated inside `GeminiProvider`.

---

## 2.4 Model Suitable for the MVP

The first AI feature is a relatively lightweight text-generation task:

```text
Technical blog post
       ↓
Suggested title
Summary
Topics
```

The application does not initially require:

- large-scale reasoning
- multimodal processing
- long-running agents
- autonomous tool use
- complex model orchestration

Therefore, a fast and relatively lightweight model was preferred for the initial implementation.

---

## 2.5 Ability to Replace the Provider

Provider lock-in was considered an architectural risk.

Instead of writing:

```ts
AIService → Gemini SDK
```

the implementation uses:

```text
AIService
    ↓
TextGenerationService
    ↓
AIProvider
    ↓
GeminiProvider
```

This means provider selection is an infrastructure decision rather than a business-logic dependency.

---

# 3. Why Gemini Was Selected Initially

Google Gemini was selected as the initial provider because it satisfied the main requirements for the first implementation:

- accessible API for development
- JavaScript/TypeScript SDK
- suitable text-generation capability
- development-friendly model options
- straightforward integration with Node.js
- provider abstraction allows replacement later

The goal was to get a working AI feature integrated into WriteSpace without introducing unnecessary infrastructure.

The first target was therefore:

```text
WriteSpace
   ↓
Gemini API
   ↓
AI Post Assistant
```

rather than building a provider-agnostic multi-provider system immediately.

---

# 4. Initial Model Selection

The first model configured during development was:

```env
AI_MODEL=gemini-3.8-flash
```

The reason for initially choosing a Flash-class model was that the Post Assistant is primarily a text-generation workload and does not require a heavyweight model.

The initial integration itself was successful from an application-code perspective.

However, requests to the selected model returned:

```text
HTTP 503
UNAVAILABLE
```

with the provider reporting that the model was experiencing high demand.  

> Source Of Truth : **[visit this link](https://discuss.ai.google.dev/t/gemini-3-8-flash-api-returns-503-but-ai-studio-works/187076)**

---

# 5. Diagnosing the 503 Error

The important part of this incident was that we did not immediately assume the WriteSpace implementation was broken.

The error initially appeared through the application:

```text
POST /api/v1/ai/post-assistant
        ↓
GeminiProvider
        ↓
503 UNAVAILABLE
```

The application retry mechanism correctly detected the `503` as a transient provider error and retried the request.

The logs showed:

```text
[AI] Text generation started using provider: gemini
[AI] Calling Gemini model=gemini-3.8-flash
[AI] Transient provider error. Retrying attempt 1/2
[AI] Calling Gemini model=gemini-3.8-flash
[AI] Transient provider error. Retrying attempt 2/2
[AI] Calling Gemini model=gemini-3.8-flash
[AI] Text generation failed
```

The important observation was:

```text
503 UNAVAILABLE
```

rather than an application validation or authentication error.

---

# 6. API Key Investigation

The next question was whether the API key was invalid.

A new Gemini API key was generated and tested.

The same `503` behavior occurred.

This made an invalid API key an unlikely explanation.

The diagnostic reasoning became:

```text
New API key
     ↓
Same model
     ↓
Same 503
     ↓
Probably not an API-key problem
```

However, instead of relying only on this assumption, a direct SDK test was created.

---

# 7. Direct Gemini Diagnostic Test

A temporary standalone script was created:

```text
src/scripts/test-gemini.ts
```

The purpose was to remove WriteSpace's application layers from the equation.

Instead of:

```text
HTTP
 ↓
Controller
 ↓
AIService
 ↓
TextGenerationService
 ↓
GeminiProvider
 ↓
Gemini
```

the test performed:

```text
Test Script
    ↓
@google/genai
    ↓
Gemini API
```

This allowed the provider itself to be tested independently.

The test initially used the problematic model and reproduced the `503` response.

This was an important diagnostic result.

---

# 8. What the Direct Test Proved

The direct test demonstrated that the problem was not caused by:

- AIController
- AIService
- TextGenerationService
- WriteSpace routing
- prompt construction
- provider factory
- retry implementation
- application-level request handling

The request was failing even when WriteSpace was completely bypassed.

The diagnostic flow was:

```text
WriteSpace request
       │
       ▼
503
       │
       ▼
Test Gemini SDK directly
       │
       ▼
503 again
       │
       ▼
Application implementation is unlikely to be the cause
```

This narrowed the problem to the provider/model side rather than the WriteSpace architecture.

---

# 9. Testing an Alternative Model

The direct diagnostic test was then changed to:

```text
gemini-3.5-flash-lite
```

The test request was intentionally simple:

```text
Reply with exactly: HELLO
```

The result was:

```text
Testing Gemini directly...
SUCCESS
HELLO
```

This was the first successful direct Gemini request.

The important comparison was:

```text
gemini-3.8-flash
        ↓
503 UNAVAILABLE

gemini-3.5-flash-lite
        ↓
SUCCESS
```

This strongly indicated that the original issue was specific to the availability/capacity of the initially selected model rather than a general inability to use the Gemini API.

---

# 10. Verifying the Working Model Inside WriteSpace

After the direct SDK test succeeded, the WriteSpace configuration was changed:

```env
AI_MODEL=gemini-3.5-flash-lite
```

The actual WriteSpace endpoint was then tested:

```http
POST /api/v1/ai/post-assistant
```

with a technical blog post about Redis caching.

The endpoint successfully returned:

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

This confirmed the complete application path:

```text
WriteSpace
   ↓
AIController
   ↓
AIService
   ↓
TextGenerationService
   ↓
GeminiProvider
   ↓
gemini-3.5-flash-lite
   ↓
Successful structured response
```

---

# 11. Final Initial Model Decision

The current development configuration is:

```env
AI_PROVIDER=gemini
AI_MODEL=gemini-3.5-flash-lite
```

The decision was based on observed behavior during integration:

```text
                         gemini-3.8-flash
                              │
                              ▼
                       HTTP 503 / unavailable
                              │
                              X

                         gemini-3.5-flash-lite
                              │
                              ▼
                       Direct SDK success
                              │
                              ▼
                       WriteSpace success
```

Therefore, `gemini-3.5-flash-lite` is currently used for the AI Post Assistant.

This decision is specifically an **initial development/model-selection decision**, not a claim that this model will permanently be the production model.

---

# 12. Why We Did Not Immediately Switch Providers

During the `503` investigation, another possible solution would have been to abandon Gemini and switch to another provider.

We intentionally did not do that immediately.

The direct SDK test showed:

```text
Gemini API
     ↓
Working
```

The issue was narrowed to the initially selected model.

Once another Gemini model successfully handled the same request, switching providers would have introduced unnecessary additional work:

```text
New provider
     ↓
New SDK
     ↓
New credentials
     ↓
New provider implementation
     ↓
New testing
     ↓
New debugging
```

Instead, we kept the existing provider architecture and changed only the model configuration.

This minimized the change required to restore functionality.

---

# 13. Provider Abstraction Still Protects Us

Although Gemini is currently working, the application is intentionally not designed around Gemini-specific business logic.

The abstraction is:

```ts
export interface AIProvider {
  generateText(
    request: AITextGenerationRequest,
  ): Promise<AITextGenerationResponse>;
}
```

The application therefore depends on:

```text
AIProvider
```

rather than:

```text
GeminiProvider
```

This means a future provider can implement the same interface.

For example:

```text
AIProvider
    ├── GeminiProvider
    ├── MockAIProvider
    └── FutureProvider
```

The exact future provider is intentionally not selected yet.

---

# 14. Provider Selection vs Model Selection

It is important to distinguish between two decisions.

## Provider

The current provider is:

```text
Google Gemini
```

This determines the external AI platform/API used by WriteSpace.

## Model

The current model is:

```text
gemini-3.5-flash-lite
```

This determines which model within that provider handles the generation request.

These decisions are separated through configuration:

```env
AI_PROVIDER=gemini
AI_MODEL=gemini-3.5-flash-lite
```

This separation allows us to change the model without changing the provider implementation.

---

# 15. Security Considerations

The provider API key is loaded from environment configuration:

```env
GEMINI_API_KEY=<secret>
```

The key is not hardcoded in source code.

The application therefore follows:

```text
.env
  ↓
Environment Configuration
  ↓
GeminiProvider
  ↓
GoogleGenAI
```

The API key should never be:

- committed to Git
- included in source code
- returned in an API response
- logged
- sent to the frontend

Only the backend provider implementation needs access to the credential.

---

# 16. Development Cost Consideration

The initial implementation is intended for local development and a college showcase.

The selected provider/model should therefore be treated as a development configuration rather than a permanent production-cost decision.

Provider pricing, model availability, quotas and free-tier policies can change.

Before production deployment, the following should be re-evaluated:

- current pricing
- free-tier limits
- rate limits
- model availability
- latency
- expected request volume
- data/privacy policies
- production SLA/reliability requirements

The application architecture intentionally keeps these concerns outside the Post Assistant business logic.

---

# 17. Current Provider Configuration

Current relevant environment variables:

```env
AI_ENABLED=true
AI_PROVIDER=gemini
AI_MODEL=gemini-3.5-flash-lite
AI_TIMEOUT_MS=60000
AI_MAX_INPUT_CHARS=12000
AI_MAX_OUTPUT_TOKENS=1000
AI_MAX_RETRIES=2
```

The `60s` timeout is currently retained while the integration is being evaluated.

It should be treated as a temporary operational value rather than a final performance target.

---

# 18. Important Engineering Lesson

The provider incident demonstrated an important engineering principle:

> An external API failure should be isolated before changing application architecture.

The initial assumption could have been:

```text
Gemini request failed
        ↓
WriteSpace implementation must be wrong
```

Instead, the debugging process was:

```text
1. Observe the actual provider error
        ↓
2. Retry transient failure
        ↓
3. Test with a new API key
        ↓
4. Bypass WriteSpace
        ↓
5. Call Gemini directly
        ↓
6. Reproduce the failure
        ↓
7. Change only the model
        ↓
8. Verify direct SDK success
        ↓
9. Verify WriteSpace success
```

This allowed us to avoid unnecessary architectural changes.

---

# 19. Provider Selection Decision Summary

| Decision                  | Current Choice          | Reason                                                          |
| ------------------------- | ----------------------- | --------------------------------------------------------------- |
| Initial AI provider       | Google Gemini           | Suitable Node.js/TypeScript integration and development usage   |
| SDK                       | `@google/genai`         | Gemini JavaScript/TypeScript integration                        |
| Initial model tested      | `gemini-3.8-flash`      | Flash-class model suitable for initial text-generation workload |
| Initial model result      | ❌ 503                  | Provider reported high demand/unavailability                    |
| Diagnostic method         | Direct SDK test         | Isolate provider/model issue from WriteSpace                    |
| Working model             | `gemini-3.5-flash-lite` | Direct SDK and WriteSpace request succeeded                     |
| Current provider          | Gemini                  | Existing integration works                                      |
| Current model             | `gemini-3.5-flash-lite` | Verified successful during development                          |
| Provider abstraction      | ✅                      | Avoid provider lock-in                                          |
| Mock provider             | ✅                      | Testing without real API calls                                  |
| Immediate provider switch | ❌                      | Not necessary after finding a working Gemini model              |

---

# 20. Current Decision

For the current WriteSpace AI MVP:

```text
Provider:
Google Gemini

SDK:
@google/genai

Model:
gemini-3.5-flash-lite
```

The architecture remains provider-independent at the application level.

The provider can therefore be replaced in the future if:

- pricing becomes unsuitable
- free-tier limits become restrictive
- model availability becomes unreliable
- latency becomes unacceptable
- another provider provides better output quality
- production requirements change

No provider migration is currently required because the existing Gemini integration is functioning successfully.

---

# 21. Related Documentation

The provider selection decision connects to:

```text
01-AI-Overview.md
        │
        ▼
02-AI-Architecture.md
        │
        ▼
03-AI-Provider-Selection.md
        │
        ├── 04-AI-Configuration.md
        │
        ├── 05-AI-Provider-Layer.md
        │
        └── decisions/
              └── 01-Gemini-as-Initial-Provider.md
```

The next document should explain the actual provider implementation in detail:

```text
05-AI-Provider-Layer.md
```

including:

- `AIProvider`
- `AITextGenerationRequest`
- `AITextGenerationResponse`
- `GeminiProvider`
- `MockAIProvider`
- provider factory
- dependency injection
- `AbortSignal`
- Gemini-specific configuration
- why provider-specific SDK code is isolated
