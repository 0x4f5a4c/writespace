# WriteSpace AI — Architecture

## 1. Purpose

This document describes the architecture of the AI subsystem currently implemented in WriteSpace.

The goal is to define:

- where AI-related code lives
- responsibilities of each layer
- how the layers communicate
- dependency direction
- separation between AI features and AI infrastructure
- important implementation decisions
- how the architecture can support future AI features

This document describes the **current implementation**, not the complete future AI roadmap.

---

# 2. Architectural Goal

The primary architectural goal was to integrate AI into the existing WriteSpace backend without tightly coupling the application to a specific AI provider.

The AI subsystem should allow us to:

1. Add AI-powered features without duplicating provider logic.
2. Change the AI provider without rewriting feature-level business logic.
3. Test AI-related business logic without making real external AI requests.
4. Centralize common AI concerns such as:
   - timeout
   - retry
   - cancellation
   - provider errors
   - logging
5. Keep WriteSpace-specific AI features separate from reusable AI infrastructure.

The resulting architecture separates the system into two major areas:

```text
Feature Layer
    ↓
AI Infrastructure Layer
    ↓
External AI Provider
```

---

# 3. Current AI Architecture

The current implementation can be represented as:

```text
                         WriteSpace Backend
                                │
                                ▼
                     ┌─────────────────────┐
                     │     AI Module       │
                     │                     │
                     │  AI Controller      │
                     │        │            │
                     │        ▼            │
                     │    AI Service       │
                     └─────────┬───────────┘
                               │
                               ▼
                  ┌──────────────────────────┐
                  │   Shared AI Layer        │
                  │                          │
                  │ TextGenerationService    │
                  │          │               │
                  │          ▼               │
                  │      AIProvider          │
                  └──────────┬───────────────┘
                             │
                 ┌───────────┴────────────┐
                 │                        │
                 ▼                        ▼
        GeminiProvider             MockAIProvider
                 │
                 ▼
        Google Gemini API
```

The important architectural boundary is between:

```text
modules/ai
```

and:

```text
shared/ai
```

---

# 4. Directory Structure

The current AI-related structure is:

```text
src/
├── modules/
│   └── ai/
│       ├── controllers/
│       │   └── ai.controller.ts
│       │
│       ├── dto/
│       │   └── post-assistant.dto.ts
│       │
│       ├── services/
│       │   └── ai.service.ts
│       │
│       └── ai.routes.ts
│
└── shared/
    └── ai/
        ├── errors/
        │   └── ai.errors.ts
        │
        ├── providers/
        │   ├── ai.provider.ts
        │   ├── gemini.provider.ts
        │   ├── mock.provider.ts
        │   └── ai-provider.factory.ts
        │
        └── services/
            └── text-generation.service.ts
```

Each directory has a different responsibility.

---

# 5. Feature Layer vs Infrastructure Layer

One of the most important architectural decisions is separating the WriteSpace-specific AI feature from generic AI infrastructure.

## Feature Layer

Located under:

```text
src/modules/ai/
```

This layer contains application-specific AI functionality.

Currently, the main feature is:

```text
AI Post Assistant
```

The feature layer knows:

- what a Post Assistant request looks like
- what suggestions should be generated
- what the expected AI response structure is
- how the prompt should be constructed

It should **not** know how Gemini's SDK works.

---

## Infrastructure Layer

Located under:

```text
src/shared/ai/
```

This layer provides reusable AI infrastructure.

It contains:

- provider abstraction
- Gemini implementation
- mock provider
- provider factory
- text-generation service
- AI errors

The infrastructure layer knows how to communicate with an external AI provider.

It should not contain WriteSpace-specific business rules such as:

> "Generate a title and topics for a blog post."

That belongs to the feature layer.

---

# 6. Layer Responsibilities

The current architecture contains the following logical layers:

```text
HTTP Layer
    │
    ▼
Controller
    │
    ▼
Feature Service
    │
    ▼
AI Infrastructure Service
    │
    ▼
Provider Abstraction
    │
    ▼
Concrete Provider
    │
    ▼
External AI API
```

Each layer has a specific responsibility.

---

## 6.1 Route Layer

Current file:

```text
src/modules/ai/ai.routes.ts
```

The route exposes:

```http
POST /api/v1/ai/post-assistant
```

Current implementation:

```ts
const router = Router();

router.post(
  "/post-assistant",
  aiController.generatePostAssistant.bind(aiController),
);

export default router;
```

### Responsibility

The route layer maps an HTTP endpoint to the appropriate controller method.

It does not:

- build prompts
- call Gemini
- parse AI output
- contain business logic

### Why?

Keeping routes thin makes the HTTP routing layer easy to understand and prevents business logic from leaking into route definitions.

---

# 7. Controller Layer

Current file:

```text
src/modules/ai/controllers/ai.controller.ts
```

The controller is responsible for handling the HTTP boundary.

The important part of the current implementation is:

```ts
const validatedRequest = postAssistantRequestSchema.safeParse(req.body);

if (!validatedRequest.success) {
  res.status(HTTP_STATUS.BAD_REQUEST).json({
    status: "fail",
    message: "Invalid post assistant request",
    errors: validatedRequest.error.flatten(),
  });

  return;
}
```

After validation:

```ts
const result = await this.aiService.generatePostAssistant(
  validatedRequest.data,
);
```

The controller then converts the result into an HTTP response.

### Controller responsibilities

The controller:

- receives the request
- validates request data
- invokes the application service
- sends the HTTP response

### Controller does not:

- construct the AI prompt
- communicate directly with Gemini
- implement retry logic
- implement timeout logic
- parse Gemini-specific responses

### Design principle

The controller acts as an adapter between:

```text
HTTP
```

and:

```text
Application logic
```

---

# 8. DTO Layer

Current file:

```text
src/modules/ai/dto/post-assistant.dto.ts
```

The DTO defines the contract for the Post Assistant.

The request contains:

```ts
export const postAssistantRequestSchema = z.object({
  title: z
    .string()
    .trim()
    .max(300, "Title cannot exceed 300 characters")
    .optional(),

  content: z
    .string()
    .trim()
    .min(1, "Content is required")
    .max(
      env.AI_MAX_INPUT_CHARS,
      `Content cannot exceed ${env.AI_MAX_INPUT_CHARS} characters`,
    ),

  instruction: z
    .string()
    .trim()
    .max(1000, "Instruction cannot exceed 1000 characters")
    .optional(),
});
```

The response is also represented by a schema:

```ts
export const postAssistantResponseSchema = z.object({
  suggestedTitle: z.string().min(1),
  summary: z.string().min(1),
  topics: z.array(z.string()).min(1),
});
```

### Why validate both sides?

The request comes from an external client.

The AI response also comes from an external system.

Therefore, both are treated as untrusted input.

```text
Client Request
     │
     ▼
Request Schema
     │
     ▼
Application
     │
     ▼
AI Provider
     │
     ▼
AI Output
     │
     ▼
Response Schema
     │
     ▼
Application Response
```

This creates a clear validation boundary around the AI system.

---

# 9. AI Service Layer

Current file:

```text
src/modules/ai/services/ai.service.ts
```

The `AIService` contains the actual Post Assistant use case.

Its main responsibility is:

```ts
generatePostAssistant(
  request: PostAssistantRequest,
): Promise<PostAssistantResponse>
```

The service first constructs a feature-specific prompt:

```ts
const prompt = this.buildPostAssistantPrompt(request);
```

Then it delegates text generation:

```ts
const response = await this.textGenerationService.generate({
  prompt,
  systemInstruction:
    "You are an AI writing assistant for a technical blogging platform. Return only valid JSON matching the requested structure.",
});
```

After receiving the model output, it parses the response:

```ts
const parsedResponse = this.parseAIResponse(response.text);
```

And validates it:

```ts
const validatedResponse = postAssistantResponseSchema.safeParse(parsedResponse);
```

---

## Why does AIService exist separately from TextGenerationService?

This is one of the most important architectural decisions.

`AIService` contains **feature-specific business logic**.

For example:

```text
Generate a suggested title
Generate a summary
Generate technical topics
```

`TextGenerationService` contains **generic AI execution logic**.

For example:

```text
timeout
retry
provider invocation
logging
cancellation
```

Therefore:

```text
AIService
    │
    │ "I need text generated for this feature"
    ▼
TextGenerationService
    │
    │ "I'll handle the AI infrastructure"
    ▼
AIProvider
```

This prevents generic AI infrastructure from becoming mixed with feature-specific logic.

---

# 10. Shared Text Generation Service

Current file:

```text
src/shared/ai/services/text-generation.service.ts
```

This is the central execution layer for text generation.

Its constructor receives an `AIProvider`:

```ts
constructor(provider: AIProvider = createAIProvider()) {
  this.provider = provider;
}
```

This means the service depends on the abstraction:

```ts
AIProvider;
```

rather than directly depending on:

```ts
GeminiProvider;
```

This is a dependency inversion decision.

---

# 11. AI Provider Interface

Current file:

```text
src/shared/ai/providers/ai.provider.ts
```

The core abstraction is:

```ts
export interface AIProvider {
  generateText(
    request: AITextGenerationRequest,
  ): Promise<AITextGenerationResponse>;
}
```

The request abstraction currently contains:

```ts
export interface AITextGenerationRequest {
  prompt: string;
  systemInstruction?: string;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}
```

And the response abstraction is:

```ts
export interface AITextGenerationResponse {
  text: string;
}
```

This interface is the most important boundary between WriteSpace and an external AI provider.

---

# 12. Why the Provider Interface Matters

Without the interface, the application could become tightly coupled to Gemini:

```text
AIService
    │
    ▼
GoogleGenAI
```

With the abstraction:

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
    │
    └── MockAIProvider
```

The application depends on a capability:

> "Generate text."

It does not depend on:

> "Generate text using Gemini's SDK."

This means a future provider can implement the same interface without changing the Post Assistant business logic.

---

# 13. Gemini Provider

Current file:

```text
src/shared/ai/providers/gemini.provider.ts
```

The Gemini provider is responsible only for translating our generic provider request into a Gemini SDK request.

The provider creates the Gemini client:

```ts
this.client = new GoogleGenAI({
  apiKey: env.GEMINI_API_KEY,
});
```

It then calls:

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

The provider converts the Gemini response into our internal response format:

```ts
return {
  text: response.text ?? "",
};
```

---

# 14. Why Gemini-Specific Code Is Isolated

The rest of WriteSpace should not need to understand:

```ts
GoogleGenAI;
```

or:

```ts
client.models.generateContent(...)
```

Those details belong inside:

```text
GeminiProvider
```

Therefore, if Gemini's SDK changes, the impact should primarily remain inside the provider implementation.

This reduces provider-specific coupling.

---

# 15. Mock Provider

Current file:

```text
src/shared/ai/providers/mock.provider.ts
```

The mock provider implements the same interface:

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

The mock provider is not intended for production AI generation.

Its purpose is testing.

Because it implements:

```ts
AIProvider;
```

it can be injected anywhere the real provider could be injected.

This allows tests to avoid:

- real Gemini API calls
- API quota consumption
- network dependency
- model variability

---

# 16. Provider Factory

Current file:

```text
src/shared/ai/providers/ai-provider.factory.ts
```

The factory selects the provider based on configuration:

```ts
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

The resulting dependency flow is:

```text
Environment Configuration
          │
          ▼
    Provider Factory
          │
     ┌────┴─────┐
     ▼          ▼
  Gemini      Mock
```

### Why use a factory?

The rest of the application does not need to contain logic such as:

```ts
if provider === "gemini"
```

The selection decision is centralized.

This keeps provider creation separate from provider usage.

---

# 17. Dependency Injection

The current architecture also uses constructor injection.

For example:

```ts
export class AIService {
  constructor(private readonly textGenerationService: TextGenerationService) {}
}
```

And:

```ts
export class TextGenerationService {
  constructor(provider: AIProvider = createAIProvider()) {
    this.provider = provider;
  }
}
```

This allows production code to use the configured implementation while tests can provide a controlled dependency.

Conceptually:

```text
Production

AIService
    │
    ▼
TextGenerationService
    │
    ▼
GeminiProvider
```

while tests can use:

```text
Test
    │
    ▼
AIService
    │
    ▼
Mock/Fake TextGenerationService
```

or:

```text
TextGenerationService
    │
    ▼
MockAIProvider
```

This makes the system easier to test in isolation.

---

# 18. Error Layer

Current file:

```text
src/shared/ai/errors/ai.errors.ts
```

The AI subsystem defines specific application-level errors:

```text
AIDisabledError
AIProviderError
AITimeoutError
AIValidationError
AIResponseParseError
```

These extend the existing WriteSpace `AppError`.

For example:

```ts
export class AITimeoutError extends AppError {
  constructor() {
    super(HTTP_STATUS.GATEWAY_TIMEOUT, "AI provider request timed out");
  }
}
```

This keeps AI failures consistent with the application's existing error-handling architecture.

---

# 19. Error Flow

The architecture converts low-level provider failures into application-level errors.

For example:

```text
Gemini API
    │
    │ 503
    ▼
GeminiProvider
    │
    ▼
TextGenerationService
    │
    ▼
Retry / final failure
    │
    ▼
AIProviderError
    │
    ▼
Global Error Middleware
    │
    ▼
HTTP Response
```

Similarly, a timeout follows:

```text
AI Request
    │
    ▼
Timeout
    │
    ▼
AbortController
    │
    ▼
AITimeoutError
    │
    ▼
Global Error Middleware
```

The detailed error behavior is documented in:

`08-AI-Error-Handling.md`

---

# 20. Complete Request Dependency Flow

For the current Post Assistant implementation:

```text
HTTP Request
     │
     ▼
ai.routes.ts
     │
     ▼
AIController
     │
     ├── Validate request
     │
     ▼
AIService
     │
     ├── Build prompt
     │
     ▼
TextGenerationService
     │
     ├── Check AI_ENABLED
     ├── Start timeout
     ├── Call provider
     ├── Retry transient failures
     ├── Abort on timeout
     └── Log execution
     │
     ▼
AIProvider
     │
     ▼
GeminiProvider
     │
     ▼
Google Gemini API
     │
     ▼
Generated text
     │
     ▼
TextGenerationService
     │
     ▼
AIService
     │
     ├── Parse JSON
     ├── Validate response schema
     │
     ▼
AIController
     │
     ▼
HTTP Response
```

This is the most important flow to understand when explaining the implementation in an interview.

---

# 21. Dependency Direction

The intended dependency direction is:

```text
Feature
  ↓
Shared AI Service
  ↓
Provider Abstraction
  ↓
Concrete Provider
  ↓
External API
```

More specifically:

```text
AIService
   ↓
TextGenerationService
   ↓
AIProvider
   ↓
GeminiProvider
   ↓
Gemini SDK
```

The feature layer does not directly depend on the Gemini SDK.

This keeps external infrastructure at the edge of the system.

---

# 22. Why We Did Not Create a Separate AI Microservice

The current AI functionality is small:

- one AI feature
- one provider
- synchronous generation
- no AI-specific database
- no independent scaling requirement

Creating a separate AI service at this stage would introduce additional infrastructure such as:

```text
WriteSpace API
      ↓
Network Call
      ↓
AI Service
      ↓
Gemini
```

instead of:

```text
WriteSpace API
      ↓
AI Infrastructure
      ↓
Gemini
```

For the current scope, the additional service boundary would add complexity without solving a concrete problem.

The current modular architecture leaves room for extracting the AI subsystem later if its scale or operational requirements justify it.

---

# 23. Why We Did Not Create AI Database Tables

The current Post Assistant is stateless from the application's perspective.

The request:

```text
Post content
```

is transformed into:

```text
AI-generated suggestions
```

and returned to the client.

There is currently no requirement to persist:

- prompts
- responses
- token usage
- AI history
- AI conversations

Therefore, adding AI-specific database tables at this stage would increase schema complexity without a current use case.

Future AI capabilities such as semantic search will introduce different persistence requirements.

---

# 24. Current Architecture vs Future Architecture

The current implementation is intentionally:

```text
                ┌─────────────────────┐
                │   AI Post Assistant  │
                └──────────┬──────────┘
                           │
                           ▼
                  Text Generation
                           │
                           ▼
                        Gemini
```

The future AI subsystem may eventually evolve toward:

```text
                       AI Foundation
                            │
             ┌──────────────┼──────────────┐
             ▼              ▼              ▼
        Post Analysis   Embeddings     Moderation
             │              │
             ▼              ▼
        Metadata       Vector Search
                            │
                            ▼
                     Related Content
                            │
                            ▼
                   Recommendation
                            │
                            ▼
                     Ranking System
                            │
                            ▼
                  Personalized Feed
```

The current provider/service boundaries are intended to support this evolution without prematurely implementing the future system.

---

# 25. Architectural Decisions Summary

| Decision                               | Reason                                                    |
| -------------------------------------- | --------------------------------------------------------- |
| Separate `modules/ai` from `shared/ai` | Separate feature logic from reusable AI infrastructure    |
| Use `AIProvider` interface             | Avoid provider-specific coupling                          |
| Use `GeminiProvider`                   | Encapsulate Gemini SDK details                            |
| Use `MockAIProvider`                   | Deterministic tests without external API calls            |
| Use provider factory                   | Centralize provider selection                             |
| Use `TextGenerationService`            | Centralize timeout, retry, logging and provider execution |
| Use `AIService`                        | Keep Post Assistant business logic separate               |
| Validate AI responses                  | Treat model output as untrusted data                      |
| Use constructor injection              | Improve testability and dependency control                |
| Keep AI in the existing backend        | Current AI scope does not justify a separate service      |
| No AI database in MVP                  | Current feature does not require persistence              |

---

# 26. Interview Explanation

A concise way to explain the architecture during an SDE interview is:

> "I integrated AI into the existing modular WriteSpace backend by separating feature-specific AI logic from generic AI infrastructure. The Post Assistant lives inside the AI module, while provider abstraction, provider implementations, error handling, and common generation concerns live in a shared AI layer. The feature service depends on a text-generation service rather than directly calling Gemini. The text-generation service depends on an `AIProvider` interface, which currently has Gemini and mock implementations. This lets me change providers and test the application without real API calls. I also centralized timeout, cancellation, retry, backoff and provider error handling so individual AI features don't have to reimplement those concerns."

---

# 27. Current Architecture Status

The following architectural components are currently implemented:

```text
✅ AI module
✅ AI routes
✅ AI controller
✅ Post Assistant DTO
✅ AI service
✅ Text generation service
✅ AI provider interface
✅ Gemini provider
✅ Mock provider
✅ Provider factory
✅ AI-specific errors
✅ Environment-based provider configuration
✅ Dependency injection
✅ Timeout and cancellation
✅ Retry and backoff
✅ Structured response validation
```

Not currently implemented:

```text
❌ Embedding service
❌ Vector database
❌ Semantic search
❌ Recommendation service
❌ Ranking service
❌ Personalized feed
❌ AI microservice
❌ AI-specific persistence
```

These are intentionally outside the current implementation scope.
