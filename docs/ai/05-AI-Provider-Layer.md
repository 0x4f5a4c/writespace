# AI Provider Layer

## 1. Purpose

The AI Provider Layer is responsible for communicating with external AI providers while keeping the rest of the WriteSpace application independent of any specific AI SDK.

Currently, WriteSpace uses:

```text
Google Gemini
```

as its actual AI provider.

However, the application does not directly call the Gemini SDK from the AI feature layer.

Instead, the architecture is:

```text
AI Feature
    ↓
TextGenerationService
    ↓
AIProvider Interface
    ↓
GeminiProvider
    ↓
Google Gemini SDK
    ↓
Gemini API
```

This abstraction allows the application to use Gemini today while keeping the possibility of adding another provider later.

---

# 2. Why a Provider Layer?

Without a provider abstraction, the AI feature could directly import the Gemini SDK:

```ts
import { GoogleGenAI } from "@google/genai";
```

and make requests directly.

For example:

```ts
const client = new GoogleGenAI({
  apiKey: env.GEMINI_API_KEY,
});

const response = await client.models.generateContent(...);
```

This would work, but it would tightly couple the feature to Gemini.

The architecture would effectively become:

```text
AI Feature
    ↓
Gemini SDK
    ↓
Gemini
```

If Gemini needed to be replaced later, the feature itself would need to change.

WriteSpace instead uses:

```text
AI Feature
    ↓
Application AI Service
    ↓
Provider Interface
    ↓
Concrete Provider
```

This creates a boundary between application logic and external AI infrastructure.

---

# 3. Current Provider Structure

The provider layer currently contains:

```text
src/shared/ai/providers/
├── ai.provider.ts
├── gemini.provider.ts
├── mock.provider.ts
└── ai-provider.factory.ts
```

Each file has a specific responsibility.

| File                     | Responsibility                           |
| ------------------------ | ---------------------------------------- |
| `ai.provider.ts`         | Defines provider contract                |
| `gemini.provider.ts`     | Implements Gemini integration            |
| `mock.provider.ts`       | Provides deterministic fake AI responses |
| `ai-provider.factory.ts` | Selects the provider implementation      |

---

# 4. Provider Interface

The most important part of the provider layer is the interface.

Current implementation:

```ts
export interface AIProvider {
  generateText(
    request: AITextGenerationRequest,
  ): Promise<AITextGenerationResponse>;
}

export interface AITextGenerationRequest {
  prompt: string;
  systemInstruction?: string;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export interface AITextGenerationResponse {
  text: string;
}
```

This interface defines the contract that every text-generation provider must satisfy.

The application does not need to know how the provider internally works.

It only needs to know:

```text
Input
  ↓
generateText()
  ↓
AI response
```

---

# 5. Why an Interface?

The interface establishes a stable contract.

For example, the application can say:

```ts
provider.generateText(request);
```

without knowing whether `provider` is:

```text
GeminiProvider
MockAIProvider
OpenAIProvider
GroqProvider
SomeFutureProvider
```

As long as the implementation satisfies:

```ts
AIProvider;
```

the higher-level application code can use it.

This is an example of **programming against an abstraction rather than a concrete implementation**.

---

# 6. `AITextGenerationRequest`

The request type currently contains:

```ts
export interface AITextGenerationRequest {
  prompt: string;
  systemInstruction?: string;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}
```

Each field has a specific purpose.

### `prompt`

Contains the actual request sent to the AI model.

For the Post Assistant, it contains the blog content and instructions for generating:

- title
- summary
- topics

### `systemInstruction`

Provides higher-level behavioral instructions to the model.

For example:

```text
You are an AI writing assistant for a technical blogging platform.
Return only valid JSON matching the requested structure.
```

### `maxOutputTokens`

Controls the maximum generated output.

The provider layer does not require the feature to know how Gemini represents this configuration.

### `signal`

Carries an `AbortSignal` used by the service layer to cancel a request when the configured timeout is reached.

This is important because the provider is part of an external network operation.

---

# 7. `AITextGenerationResponse`

The provider returns:

```ts
export interface AITextGenerationResponse {
  text: string;
}
```

The application intentionally receives a simple response rather than the complete provider-specific SDK response.

For example, Gemini internally returns a much richer SDK response.

The provider converts that into:

```ts
{
  text: string;
}
```

This prevents Gemini-specific response structures from leaking into the rest of the application.

---

# 8. Gemini Provider

The actual Gemini integration is implemented in:

```text
src/shared/ai/providers/gemini.provider.ts
```

Current implementation:

```ts
import { GoogleGenAI } from "@google/genai";

import env from "../../../config/env";
import {
  AIProvider,
  AITextGenerationRequest,
  AITextGenerationResponse,
} from "./ai.provider";
import logger from "../../../config/logger";

export class GeminiProvider implements AIProvider {
  private readonly client: GoogleGenAI;

  constructor() {
    this.client = new GoogleGenAI({
      apiKey: env.GEMINI_API_KEY,
    });
  }

  async generateText(
    request: AITextGenerationRequest,
  ): Promise<AITextGenerationResponse> {
    logger.debug(`[AI] Calling Gemini model=${env.AI_MODEL}`);

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

    logger.debug(`[AI] Gemini response received`);

    return {
      text: response.text ?? "",
    };
  }
}
```

---

# 9. Gemini SDK Initialization

The Gemini client is created inside the provider:

```ts
this.client = new GoogleGenAI({
  apiKey: env.GEMINI_API_KEY,
});
```

The API key comes from the validated application configuration.

The key is therefore not embedded in the provider implementation.

The dependency chain is:

```text
.env
 ↓
env.ts
 ↓
env.GEMINI_API_KEY
 ↓
GeminiProvider
 ↓
GoogleGenAI
```

---

# 10. Why SDK Initialization Belongs Here

The Gemini SDK is infrastructure-specific.

The AI feature should not have to know:

```ts
new GoogleGenAI(...)
```

or:

```ts
client.models.generateContent(...)
```

Those details belong to the provider.

This keeps the boundary clean:

```text
Application Layer
    ↓
AIProvider
    ↓
Infrastructure Layer
    ↓
Gemini SDK
```

If Gemini's SDK changes later, ideally only the provider implementation needs to change.

---

# 11. Calling Gemini

The provider calls:

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

There are several important design decisions here.

---

# 12. Model Comes From Configuration

The model is not hardcoded:

```ts
model: env.AI_MODEL;
```

The current configuration selects:

```env
AI_MODEL=gemini-3.5-flash-lite
```

This allows the model to be changed without changing the provider implementation.

Therefore:

```text
Provider
    ↓
Knows how to communicate with Gemini

Configuration
    ↓
Determines which Gemini model to use
```

This is an important separation of responsibilities.

---

# 13. Prompt Comes From the Application Layer

The provider receives:

```ts
request.prompt;
```

and passes it to Gemini:

```ts
contents: request.prompt;
```

The provider does not construct the Post Assistant prompt.

That responsibility belongs to `AIService`.

This distinction is important.

### AIService

Knows:

```text
What should the AI be asked to do?
```

### GeminiProvider

Knows:

```text
How should that request be sent to Gemini?
```

Therefore:

```text
AIService
    ↓
Builds prompt
    ↓
TextGenerationService
    ↓
AIProvider
    ↓
GeminiProvider
    ↓
Gemini
```

---

# 14. System Instructions

The provider supports:

```ts
systemInstruction: request.systemInstruction;
```

The current Post Assistant sends a system instruction similar to:

```text
You are an AI writing assistant for a technical blogging platform.
Return only valid JSON matching the requested structure.
```

The provider simply forwards this instruction.

It does not decide what the instruction should be.

Again, this keeps application behavior separate from provider communication.

---

# 15. Output Token Configuration

The provider uses:

```ts
maxOutputTokens:
  request.maxOutputTokens ?? env.AI_MAX_OUTPUT_TOKENS,
```

This means:

1. If the caller explicitly provides `maxOutputTokens`, use it.
2. Otherwise use the application-level default.

Currently:

```env
AI_MAX_OUTPUT_TOKENS=1000
```

This provides a sensible default while keeping the provider interface flexible.

---

# 16. Abort Signal

The provider accepts:

```ts
signal?: AbortSignal;
```

and forwards it:

```ts
abortSignal: request.signal,
```

This connects the provider to the timeout mechanism implemented in `TextGenerationService`.

The flow is:

```text
TextGenerationService
        │
        │ creates AbortController
        ▼
AbortSignal
        │
        ▼
AIProvider
        │
        ▼
GeminiProvider
        │
        ▼
Gemini SDK
```

The provider itself does not decide when a request should timeout.

It simply supports cancellation through the abstraction.

This is a good separation of responsibility.

---

# 17. Thinking Configuration

The current Gemini provider includes:

```ts
thinkingConfig: {
  thinkingLevel: "low",
},
```

This is part of the current Gemini-specific implementation.

It is intentionally located inside `GeminiProvider` rather than inside the generic `AIProvider` interface.

Why?

Because this is provider/model-specific configuration.

The generic interface should avoid exposing every provider's unique configuration.

For example, if another provider has a completely different reasoning configuration, the generic application layer should not need to understand it.

This follows the principle:

> Provider-specific details should remain inside the provider implementation whenever possible.

---

# 18. Normalizing the Gemini Response

Gemini returns a provider-specific SDK response.

WriteSpace converts it to:

```ts
return {
  text: response.text ?? "",
};
```

The rest of the application therefore receives:

```ts
AITextGenerationResponse;
```

instead of a Gemini SDK response object.

This is one of the most important responsibilities of the provider layer.

---

# 19. Why Response Normalization Matters

Suppose the AI service directly depended on Gemini's response structure.

It might contain code like:

```ts
response.text;
```

or other Gemini-specific response handling.

If the provider changed, that code could break.

Instead:

```text
Gemini response
      ↓
GeminiProvider
      ↓
AITextGenerationResponse
      ↓
AIService
```

The application only understands the internal contract.

This reduces coupling.

---

# 20. Mock Provider

The provider layer also contains:

```text
src/shared/ai/providers/mock.provider.ts
```

Current implementation:

```ts
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

The mock provider implements exactly the same interface:

```ts
implements AIProvider
```

as the real Gemini provider.

---

# 21. Why Create a Mock Provider?

The mock provider is primarily useful for testing.

Automated tests should not need to call the real Gemini API.

Real provider calls would introduce:

- network dependency
- API credentials
- latency
- provider availability issues
- unpredictable model output
- API quota consumption
- possible costs

The mock provider avoids all of these.

The test can simply use deterministic output.

---

# 22. Provider Interchangeability

Because both implementations satisfy:

```ts
AIProvider;
```

the application can use either:

```text
GeminiProvider
```

or:

```text
MockAIProvider
```

without changing the AI feature's business logic.

Conceptually:

```text
             ┌── GeminiProvider
             │
AIProvider ──┤
             │
             └── MockAIProvider
```

This is the core benefit of the abstraction.

---

# 23. Provider Factory

Provider selection is centralized in:

```text
src/shared/ai/providers/ai-provider.factory.ts
```

Current implementation:

```ts
import env from "../../../config/env";
import { AIProvider } from "./ai.provider";
import { GeminiProvider } from "./gemini.provider";
import { MockAIProvider } from "./mock.provider";

export function createAIProvider(): AIProvider {
  switch (env.AI_PROVIDER) {
    case "gemini":
      return new GeminiProvider();

    case "mock":
      return new MockAIProvider();

    default:
      throw new Error(`Unsupported AI provider: ${env.AI_PROVIDER}`);
  }
}
```

---

# 24. Why Use a Factory?

Without a factory, different parts of the application might contain provider-selection logic:

```ts
if (env.AI_PROVIDER === "gemini") {
  ...
}
```

This would spread provider knowledge across the codebase.

Instead, provider selection is centralized:

```text
AI_PROVIDER
    ↓
Provider Factory
    ↓
Concrete Provider
```

The rest of the application simply receives an `AIProvider`.

---

# 25. Factory Responsibilities

The factory has one primary responsibility:

> Decide which concrete provider implementation should be instantiated.

It does not:

- generate prompts
- call the AI model
- parse AI responses
- validate feature-specific responses
- handle retries
- handle timeout logic
- contain business logic

Those responsibilities belong to other layers.

---

# 26. Dependency Injection

The provider abstraction becomes particularly useful through dependency injection.

`TextGenerationService` accepts an optional provider:

```ts
constructor(
  provider: AIProvider = createAIProvider(),
) {
  this.provider = provider;
}
```

This means production code can use the configured provider:

```text
TextGenerationService
        ↓
createAIProvider()
        ↓
GeminiProvider
```

while tests can provide their own implementation:

```text
Test
 ↓
Mock AIProvider
 ↓
TextGenerationService
```

This makes the service easier to test.

---

# 27. Why Dependency Injection Matters

Without dependency injection, `TextGenerationService` would directly construct:

```ts
new GeminiProvider();
```

That would make testing more difficult.

Instead, it depends on:

```ts
AIProvider;
```

This is dependency inversion in practice.

The service depends on an abstraction rather than a concrete provider.

---

# 28. Provider Layer vs Service Layer

It is important to understand the difference.

### Provider Layer

Responsible for:

- communicating with external AI provider
- translating application request into provider SDK request
- translating provider response into application response
- handling provider-specific SDK details

### Service Layer

Responsible for:

- deciding whether AI is enabled
- retrying transient failures
- enforcing timeout behavior
- logging request lifecycle
- normalizing provider failures
- coordinating AI generation

### Feature Service

Responsible for:

- building feature-specific prompts
- parsing structured AI output
- validating feature-specific responses
- implementing feature-specific business logic

Therefore:

```text
Feature Service
      ↓
TextGenerationService
      ↓
AIProvider
      ↓
GeminiProvider
      ↓
Gemini SDK
```

Each layer has a different responsibility.

---

# 29. Full Dependency Flow

The current dependency structure can be visualized as:

```text
AIController
      │
      ▼
AIService
      │
      ▼
TextGenerationService
      │
      ▼
AIProvider
      │
      ├───────────────┐
      ▼               ▼
GeminiProvider   MockAIProvider
      │
      ▼
GoogleGenAI SDK
      │
      ▼
Gemini API
```

The important boundary is:

```text
AIProvider
```

Everything below that boundary is infrastructure/provider-specific.

Everything above that boundary is application-level AI logic.

---

# 30. Dependency Direction

The dependency direction is intentionally:

```text
Feature
   ↓
Service
   ↓
Abstraction
   ↓
Implementation
```

rather than:

```text
Feature
   ↓
Gemini SDK
```

This reduces coupling between business logic and external infrastructure.

---

# 31. Adding Another Provider in the Future

Suppose WriteSpace eventually needs another provider.

For example:

```text
OpenAI
```

A future implementation could be:

```text
src/shared/ai/providers/openai.provider.ts
```

implementing:

```ts
export class OpenAIProvider implements AIProvider {
  ...
}
```

Then the factory could be extended:

```ts
switch (env.AI_PROVIDER) {
  case "gemini":
    return new GeminiProvider();

  case "openai":
    return new OpenAIProvider();

  case "mock":
    return new MockAIProvider();

  default:
    throw new Error(...);
}
```

The important part is that the feature service would not need to change.

The feature would continue using:

```ts
AIProvider;
```

---

# 32. Why We Did Not Add Multiple Providers Now

Only Gemini and Mock are currently implemented.

Adding several real providers at the MVP stage would introduce unnecessary complexity.

It would require:

- additional SDK dependencies
- additional credentials
- provider-specific testing
- provider-specific configuration
- additional failure modes
- more maintenance

The abstraction already provides the ability to add another provider later.

Therefore:

> We implemented the abstraction now, but deferred additional real providers until there is an actual requirement.

This is an example of avoiding premature complexity while keeping the architecture extensible.

---

# 33. Provider-Specific Logic Stays Isolated

One of the key architectural rules is:

> Gemini-specific behavior should stay inside `GeminiProvider`.

For example:

```ts
import { GoogleGenAI } from "@google/genai";
```

belongs inside:

```text
gemini.provider.ts
```

and should not appear throughout the application.

Similarly, Gemini-specific configuration such as:

```ts
thinkingConfig: {
  thinkingLevel: "low",
}
```

belongs inside the provider implementation.

This prevents provider-specific details from spreading across the application.

---

# 34. Logging in the Provider

The Gemini provider currently logs:

```ts
logger.debug(`[AI] Calling Gemini model=${env.AI_MODEL}`);
```

and after receiving a response:

```ts
logger.debug(`[AI] Gemini response received`);
```

The logs intentionally do not print:

- API keys
- complete prompts
- generated content
- sensitive user information

The purpose of these logs is primarily operational visibility.

For example:

```text
[AI] Calling Gemini model=gemini-3.5-flash-lite
[AI] Gemini response received
```

can help determine whether a request reached the provider and returned successfully.

---

# 35. Error Handling Boundary

The provider layer itself does not convert every provider failure into an application-specific error.

The provider allows the underlying error to propagate.

`TextGenerationService` then handles:

- timeout
- retryable errors
- provider errors
- unexpected failures

This keeps provider communication separate from application-level reliability policy.

Therefore:

```text
GeminiProvider
    ↓
Provider error
    ↓
TextGenerationService
    ↓
Retry / normalize / propagate
```

This is preferable to duplicating retry and timeout logic inside every provider implementation.

---

# 36. Why Retry Logic Is Not Inside GeminiProvider

It may initially seem natural to put retries here:

```text
GeminiProvider
    ↓
retry Gemini
```

But retries are not inherently Gemini-specific.

They are part of the application's external-dependency reliability policy.

If another provider is added, we should not have to duplicate:

```text
retry logic
timeout logic
logging
error normalization
```

for every provider.

Instead:

```text
TextGenerationService
       ↓
Reliability policy
       ↓
Any AIProvider
```

This makes the reliability behavior provider-independent.

---

# 37. Why Timeout Logic Is Not Inside GeminiProvider

The same reasoning applies to timeouts.

The application wants a general rule:

> An AI request should not exceed the configured timeout.

That rule should apply regardless of whether the provider is:

```text
Gemini
OpenAI
Mock
Future Provider
```

Therefore timeout handling belongs to:

```text
TextGenerationService
```

while provider implementations simply support the provided `AbortSignal`.

---

# 38. Testing the Provider Abstraction

The provider abstraction also makes the service layer testable.

For example, the tests can provide a fake provider that:

```text
returns success
throws a 503
throws a timeout
throws another error
```

without making real network calls.

The existing `TextGenerationService` tests use this approach.

This allows testing the application's reliability behavior independently of Gemini.

---

# 39. Real Provider Verification

During implementation, the initial Gemini model produced a provider-side `503 UNAVAILABLE` response indicating temporary high demand.

A direct SDK diagnostic test was used to distinguish between:

```text
API key problem
```

and:

```text
model/provider availability problem
```

A different configured Gemini model successfully generated a response.

The final WriteSpace endpoint was then tested successfully through:

```text
POST /api/v1/ai/post-assistant
```

This confirmed that the provider abstraction was working end-to-end:

```text
HTTP Request
   ↓
AIController
   ↓
AIService
   ↓
TextGenerationService
   ↓
GeminiProvider
   ↓
Gemini SDK
   ↓
Gemini
   ↓
Normalized text response
   ↓
Post Assistant response
```

---

# 40. Important Architectural Decision

The provider abstraction is intentionally small.

It currently exposes only:

```ts
generateText(...)
```

rather than trying to model every possible AI capability.

This is important because the current MVP only requires text generation.

Future capabilities such as embeddings may eventually require another abstraction, for example:

```text
EmbeddingProvider
```

or a broader AI capability design.

That should be introduced when Semantic Search is implemented rather than prematurely expanding the current interface.

---

# 41. Current Provider Architecture

The current architecture is:

```text
src/shared/ai/
│
├── providers/
│   ├── ai.provider.ts
│   ├── gemini.provider.ts
│   ├── mock.provider.ts
│   └── ai-provider.factory.ts
│
├── services/
│   └── text-generation.service.ts
│
└── errors/
    └── ai.errors.ts
```

The relationship is:

```text
AIProvider
   │
   ├── GeminiProvider
   │
   └── MockAIProvider
          ▲
          │
    Provider Factory
          ▲
          │
TextGenerationService
```

---

# 42. Design Principles Used

The provider layer demonstrates several important software-engineering principles.

## Abstraction

The application depends on:

```ts
AIProvider;
```

instead of Gemini directly.

## Dependency Inversion

Higher-level application logic does not depend directly on the Gemini SDK.

## Dependency Injection

`TextGenerationService` accepts an `AIProvider`.

## Separation of Concerns

Provider communication is separated from:

- prompt construction
- business logic
- validation
- retries
- timeout handling

## Encapsulation

Gemini SDK-specific details remain inside `GeminiProvider`.

## Testability

`MockAIProvider` allows deterministic testing without external API calls.

## Extensibility

Another provider can be added without rewriting the AI feature layer.

---

# 43. Interview Explanation

If an interviewer asks:

> "Why did you create an AI provider abstraction instead of directly calling Gemini?"

A strong answer would be:

> "I didn't want the feature layer to be tightly coupled to Gemini's SDK. I created an `AIProvider` interface that exposes a generic `generateText` contract. `GeminiProvider` implements that interface and handles all Gemini SDK-specific details. The application service depends on the abstraction, so I can replace Gemini or add another provider without changing the feature's business logic."

---

If asked:

> "Why do you have a factory?"

Answer:

> "The factory centralizes provider selection. Instead of spreading checks like `if provider === gemini` throughout the application, the factory creates the appropriate implementation based on configuration. The rest of the system only receives an `AIProvider`."

---

If asked:

> "Why do you need a mock provider?"

Answer:

> "I don't want automated tests to depend on a real AI API. A real model introduces network dependency, latency, quota consumption, nondeterministic output, and potentially cost. The mock provider implements the same interface and gives deterministic responses, so I can test the application's behavior independently of Gemini."

---

If asked:

> "Where do retries belong?"

Answer:

> "Retries belong in the `TextGenerationService`, not the Gemini provider, because retry policy is an application-level reliability concern rather than a Gemini-specific concern. That way, if I add another provider, I don't have to duplicate timeout and retry logic."

---

If asked:

> "What happens if you replace Gemini?"

Answer:

> "I would implement another provider that satisfies `AIProvider`, add it to the provider factory and configuration, and keep the feature and service layers unchanged. That's the main benefit of the abstraction."

---

# 44. Current vs Future

### Currently implemented

```text
✓ AIProvider interface
✓ GeminiProvider
✓ MockAIProvider
✓ Provider factory
✓ Dependency injection
✓ Gemini SDK integration
✓ Response normalization
✓ AbortSignal support
✓ Provider-specific Gemini configuration
✓ Provider-independent retry/timeout handling
✓ Provider abstraction tests
```

### Future possibilities

```text
○ Additional real AI provider
○ Dedicated embedding provider
○ Provider fallback strategy
○ Provider/model selection based on workload
○ AI provider health monitoring
○ Provider-level metrics
```

These are not part of the current MVP.

---

# 45. Final Architecture Summary

The central idea of the provider layer is:

```text
                 ┌──────────────────┐
                 │   AI Feature     │
                 └────────┬─────────┘
                          │
                          ▼
                 ┌──────────────────┐
                 │ AIService        │
                 └────────┬─────────┘
                          │
                          ▼
                 ┌──────────────────┐
                 │ TextGeneration   │
                 │ Service          │
                 └────────┬─────────┘
                          │
                          ▼
                 ┌──────────────────┐
                 │   AIProvider     │
                 │   Interface      │
                 └────────┬─────────┘
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
     ┌─────────────────┐    ┌─────────────────┐
     │ GeminiProvider  │    │ MockAIProvider  │
     └────────┬────────┘    └─────────────────┘
              │
              ▼
     ┌─────────────────┐
     │ GoogleGenAI SDK │
     └────────┬────────┘
              │
              ▼
        Gemini API
```

The most important architectural boundary is:

```text
AIProvider
```

Everything above it works with the application's generic AI contract.

Everything below it is responsible for communicating with a particular AI implementation.

This gives WriteSpace a clean separation between **AI feature logic**, **AI reliability logic**, and **external AI-provider infrastructure**.

---

# 46. Related Documentation

This document should be read together with:

```text
docs/ai/
├── 01-AI-Overview.md
├── 02-AI-Architecture.md
├── 03-AI-Provider-Selection.md
├── 04-AI-Configuration.md
├── 05-AI-Provider-Layer.md
├── 06-AI-Service-Layer.md
├── 07-AI-Request-Lifecycle.md
├── 08-AI-Error-Handling.md
├── 09-AI-Reliability.md
└── 10-AI-Testing.md
```

The next document should be:

```text
06-AI-Service-Layer.md
```

That document will go deeper into `TextGenerationService`, which is currently the **central orchestration layer** between the AI features and providers.

It should cover:

- why `TextGenerationService` exists
- `generate()`
- `generateWithRetry()`
- `generateWithTimeout()`
- retry classification
- exponential backoff
- `AbortController`
- `AI_ENABLED`
- error normalization
- logging
- dependency injection
- why reliability logic belongs here
- the complete execution flow
- and the interview questions around the design.
