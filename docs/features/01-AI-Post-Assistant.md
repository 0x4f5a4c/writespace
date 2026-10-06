# AI Post Assistant

## 1. Overview

The **AI Post Assistant** is the first AI-powered feature implemented in WriteSpace.

Its purpose is to help users prepare technical blog posts by generating suggestions from the post content.

The current implementation generates:

- a suggested title,
- a short summary,
- relevant technical topics.

The feature accepts the user's draft content and sends it through the WriteSpace AI abstraction layer to the configured AI provider.

The generated result is returned to the client and is **not persisted in the database**.

---

# 2. Problem the Feature Solves

Writing a technical blog post often requires several supporting tasks after the main content has been written.

For example, a user may have written the following:

```text
Redis is an in-memory data store commonly used for caching
frequently accessed data. It can improve application performance
by reducing repeated database queries.
```

The user may still need to decide:

- What should the title be?
- How should the content be summarized?
- What technical topics does this post cover?

The AI Post Assistant automates these suggestions.

Instead of requiring the user to manually generate each piece of metadata, WriteSpace can produce suggestions from the existing draft.

---

# 3. Current Scope

The current implementation intentionally keeps the feature small.

### Implemented

```text
AI Post Assistant
        |
        +--> Suggested Title
        |
        +--> Summary
        |
        +--> Topics
```

### Not implemented

The current feature does not:

- automatically modify the user's post,
- automatically publish the post,
- save AI suggestions to the database,
- replace the user's original content,
- maintain an AI conversation,
- maintain user-specific AI history,
- use a separate AI database,
- use asynchronous background processing.

The AI response is currently a **suggestion** returned to the client.

The client/user can decide what to do with it.

---

# 4. Feature Philosophy

The feature follows a simple principle:

> **AI should assist the user rather than silently change the user's content.**

The user's original post remains under the user's control.

The AI generates suggestions, but the application does not automatically persist or publish those suggestions.

This makes the first AI feature relatively low-risk while still demonstrating practical AI integration.

---

# 5. User Flow

The current flow is:

```text
User writes draft
      |
      v
Client sends title/content/instruction
      |
      v
POST /api/v1/ai/post-assistant
      |
      v
Request validation
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
AI-generated JSON
      |
      v
JSON parsing
      |
      v
Response schema validation
      |
      v
API response
      |
      v
Client displays suggestions
```

---

# 6. API Endpoint

The current endpoint is:

```http
POST /api/v1/ai/post-assistant
```

The route is registered under the AI router:

```ts
router.post(
  "/post-assistant",
  aiController.generatePostAssistant.bind(aiController),
);
```

The AI routes are mounted in the application under:

```ts
app.use("/api/v1/ai", aiRoutes);
```

Therefore the final endpoint becomes:

```text
POST /api/v1/ai/post-assistant
```

---

# 7. Request Contract

The request body is validated using Zod.

Current request schema:

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

The request contains three fields.

---

# 8. `title`

The title is optional.

```text
title: string | undefined
```

Maximum length:

```text
300 characters
```

The title provides additional context to the AI model.

A user can therefore submit:

```json
{
  "title": "Understanding Redis Caching",
  "content": "Redis is an in-memory data store..."
}
```

or:

```json
{
  "content": "Redis is an in-memory data store..."
}
```

When the title is missing, the prompt explicitly tells the model:

```text
No title provided
```

---

# 9. `content`

The content is required.

```ts
content: z
  .string()
  .trim()
  .min(1, "Content is required")
  .max(env.AI_MAX_INPUT_CHARS, ...)
```

This is the main input to the AI feature.

The maximum length is configuration-driven:

```env
AI_MAX_INPUT_CHARS=12000
```

Therefore the feature does not hard-code the AI input limit directly into the DTO.

---

# 10. Why Limit Content Size?

AI requests have practical constraints.

Allowing arbitrarily large content could result in:

- unnecessarily large requests,
- increased latency,
- increased provider usage,
- higher resource consumption,
- provider token/context limitations.

The configurable input limit provides a basic protection boundary before the request reaches the provider.

---

# 11. `instruction`

The instruction is optional.

```text
instruction: string | undefined
```

Maximum length:

```text
1000 characters
```

This allows the user to provide additional context.

For example:

```json
{
  "instruction": "Make the suggestions suitable for backend developers."
}
```

This gives the user some control over how the AI generates the suggestions.

If no instruction is supplied, the prompt uses:

```text
None
```

---

# 12. Example Request

A real request used to verify the endpoint was:

```json
{
  "title": "Understanding Redis Caching",
  "content": "Redis is an in-memory data store commonly used for caching frequently accessed data. It can improve application performance by reducing repeated database queries.",
  "instruction": "Make the suggestions suitable for backend developers."
}
```

Endpoint:

```http
POST http://localhost:3000/api/v1/ai/post-assistant
```

---

# 13. Request Validation Flow

The controller validates the request before invoking the AI service.

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

Therefore:

```text
Client Request
      |
      v
Zod Validation
      |
      +---- Invalid ----> 400 Bad Request
      |
      +---- Valid ------> AIService
```

This prevents invalid input from reaching the AI provider.

---

# 14. Controller Responsibility

The controller is intentionally thin.

Its main responsibilities are:

1. Receive the HTTP request.
2. Validate the request body.
3. Call the feature service.
4. Return the HTTP response.

The controller does not:

- construct the AI prompt,
- communicate with Gemini,
- implement retries,
- implement timeout logic,
- parse AI JSON,
- validate the AI response schema.

Those responsibilities belong to other layers.

---

# 15. Controller Implementation

The current controller follows this structure:

```ts
public async generatePostAssistant(
  req: Request,
  res: Response,
): Promise<void> {
  const validatedRequest =
    postAssistantRequestSchema.safeParse(req.body);

  if (!validatedRequest.success) {
    res.status(HTTP_STATUS.BAD_REQUEST).json({
      status: "fail",
      message: "Invalid post assistant request",
      errors: validatedRequest.error.flatten(),
    });

    return;
  }

  const result = await this.aiService.generatePostAssistant(
    validatedRequest.data,
  );

  res.status(HTTP_STATUS.OK).json({
    status: "success",
    data: result,
  });
}
```

The controller delegates the actual feature logic to `AIService`.

---

# 16. Feature Service

The feature-specific business logic lives in:

```text
AIService
```

The main method is:

```ts
generatePostAssistant(
  request: PostAssistantRequest
): Promise<PostAssistantResponse>
```

Its responsibilities are:

1. Build the feature-specific prompt.
2. Call the shared text-generation service.
3. Parse the AI response.
4. Validate the parsed response.
5. Return the validated result.

This keeps Post Assistant-specific logic separate from generic AI infrastructure.

---

# 17. AIService Flow

The implementation follows:

```text
PostAssistantRequest
        |
        v
buildPostAssistantPrompt()
        |
        v
TextGenerationService.generate()
        |
        v
AI response text
        |
        v
parseAIResponse()
        |
        v
Zod response validation
        |
        v
PostAssistantResponse
```

This is an important separation in the architecture.

---

# 18. Prompt Construction

The prompt is constructed by:

```ts
private buildPostAssistantPrompt(
  request: PostAssistantRequest
): string
```

The current prompt includes:

```text
Generate suggestions for the following technical blog post.

Post title:
...

Post content:
...

Additional instruction:
...

Return ONLY valid JSON in exactly this structure:

{
  "suggestedTitle": "string",
  "summary": "string",
  "topics": ["string"]
}
```

The prompt also specifies requirements for each output field.

---

# 19. Why Prompt Construction Belongs in AIService

The prompt is specific to the **Post Assistant feature**.

It is not generic AI infrastructure.

For example:

```text
Post Assistant
    |
    v
Post-specific prompt
```

while another future feature might have:

```text
Semantic Search
    |
    v
Embedding request
```

or:

```text
Future Writing Assistant
    |
    v
Writing-specific prompt
```

Therefore prompt construction belongs to the feature layer rather than the shared provider layer.

---

# 20. System Instruction

The feature also provides a system instruction:

```ts
systemInstruction: "You are an AI writing assistant for a technical blogging platform. Return only valid JSON matching the requested structure.";
```

This establishes the role and output expectation separately from the feature prompt.

The separation is:

```text
System Instruction
        |
        v
General role / behavior

Prompt
        |
        v
Specific post + requested output
```

---

# 21. Why Request Structured JSON?

The application needs predictable fields:

```text
suggestedTitle
summary
topics
```

Returning arbitrary natural-language text would make it difficult for the client to reliably consume the result.

For example, this is difficult to process reliably:

```text
Here are some suggestions:

Title: ...
Summary: ...
Topics: ...
```

Instead, the feature requests:

```json
{
  "suggestedTitle": "...",
  "summary": "...",
  "topics": ["...", "..."]
}
```

This provides a clear application-level contract.

---

# 22. Important AI Principle: Model Output Is Untrusted

Even though the prompt asks for valid JSON, the application does not blindly trust the model.

The response goes through two stages:

```text
AI Text
   |
   v
JSON.parse()
   |
   v
Zod schema validation
```

This is important because a model is an external system from the application's perspective.

The application must validate its output just like any other external dependency.

---

# 23. Response Parsing

The current implementation parses the response using:

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

If the provider returns malformed JSON, the feature throws:

```text
AIResponseParseError
```

instead of returning malformed data to the client.

---

# 24. Response Schema

The expected response is defined using Zod:

```ts
export const postAssistantResponseSchema = z.object({
  suggestedTitle: z.string().min(1),
  summary: z.string().min(1),
  topics: z.array(z.string()).min(1),
});
```

The required fields are:

```text
suggestedTitle -> non-empty string
summary        -> non-empty string
topics         -> non-empty array of strings
```

---

# 25. Response Validation

After parsing:

```ts
const validatedResponse = postAssistantResponseSchema.safeParse(parsedResponse);
```

If validation fails:

```ts
throw new AIResponseParseError();
```

Therefore there are two distinct failure boundaries:

```text
Malformed JSON
      |
      v
JSON.parse()
      |
      X
AIResponseParseError
```

and:

```text
Valid JSON
      |
      v
Zod schema
      |
      X
AIResponseParseError
```

---

# 26. Why Use Both JSON.parse and Zod?

These solve different problems.

### `JSON.parse`

Checks:

> Is the model output syntactically valid JSON?

### Zod

Checks:

> Does the JSON have the structure required by the application?

For example:

```json
{
  "title": "Redis"
}
```

is valid JSON.

But it is not valid Post Assistant output.

Therefore:

```text
JSON syntax ≠ Application contract
```

Both validations are required.

---

# 27. Expected Response

A successful response has the structure:

```json
{
  "status": "success",
  "data": {
    "suggestedTitle": "string",
    "summary": "string",
    "topics": ["string"]
  }
}
```

The actual HTTP status is:

```text
200 OK
```

---

# 28. Actual API Response

During actual endpoint verification, the response was:

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

This confirmed that the complete application path from HTTP request to Gemini response was functioning.

---

# 29. Complete Architecture

The Post Assistant sits on top of the shared AI infrastructure:

```text
                         Client
                           |
                           | POST
                           v
              /api/v1/ai/post-assistant
                           |
                           v
                    AIController
                           |
                     Zod Request
                     Validation
                           |
                           v
                      AIService
                           |
                 Build Feature Prompt
                           |
                           v
               TextGenerationService
                           |
              +------------+------------+
              |                         |
        Timeout / Retry            AI Enabled?
              |                         |
              +------------+------------+
                           |
                           v
                    AIProvider
                           |
                    Provider Factory
                           |
                           v
                   GeminiProvider
                           |
                           v
                     Gemini API
                           |
                           v
                     AI Text
                           |
                           v
                  JSON.parse()
                           |
                           v
                 Zod Response Schema
                           |
                           v
                    AIController
                           |
                           v
                      HTTP 200
```

---

# 30. Layer Responsibilities

| Layer                 | Responsibility                        |
| --------------------- | ------------------------------------- |
| Route                 | Maps HTTP endpoint to controller      |
| Controller            | Request validation and HTTP response  |
| AIService             | Post Assistant feature logic          |
| Prompt Builder        | Creates feature-specific prompt       |
| TextGenerationService | Shared AI reliability                 |
| AIProvider            | Provider abstraction                  |
| GeminiProvider        | Gemini SDK integration                |
| JSON Parser           | Parses model output                   |
| Zod Response Schema   | Validates output structure            |
| Global Error Handler  | Handles propagated application errors |

This separation prevents the Post Assistant from becoming tightly coupled to Gemini.

---

# 31. Why the Feature Does Not Save AI Suggestions

The current implementation intentionally does not create database records for AI suggestions.

The flow ends at:

```text
AI Response
    |
    v
HTTP Response
    |
    v
Client
```

There is no:

```text
AI Response
    |
    v
Database
```

in the current MVP.

---

# 32. Reason for Not Persisting AI Output

The generated title, summary and topics are suggestions.

The user may:

- accept them,
- modify them,
- reject them,
- generate another result.

Persisting every generated suggestion would introduce additional complexity:

- AI history,
- storage requirements,
- cleanup,
- ownership rules,
- schema design,
- versioning,
- potentially large amounts of generated data.

For the first AI feature, that complexity is not necessary.

---

# 33. User-Controlled Workflow

The current design allows:

```text
User Draft
    |
    v
AI Suggestions
    |
    +---- Accept
    |
    +---- Edit
    |
    +---- Reject
```

The AI does not become the source of truth.

The user's actual post remains the source of truth.

---

# 34. No AI-Specific Database

The Post Assistant currently does not require:

```text
AI tables
AI history
AI usage table
AI suggestion table
```

This is deliberate.

The feature can provide useful functionality using the existing application data and the AI provider without introducing a new persistence subsystem.

---

# 35. Interaction With Existing Post Data

The Post Assistant can consume information that already exists conceptually in the post workflow:

```text
Title
Content
```

It generates:

```text
Suggested Title
Summary
Topics
```

The current implementation does not directly modify the Post database record.

Therefore:

```text
Existing Post
     |
     v
AI Assistant
     |
     v
Suggestions
     |
     v
Client
```

rather than:

```text
Existing Post
     |
     v
AI Assistant
     |
     v
Automatic DB Update
```

---

# 36. Error Handling

The feature can encounter errors at multiple stages.

### Invalid client request

```text
400 Bad Request
```

### AI disabled

```text
AIDisabledError
```

### Provider timeout

```text
AITimeoutError
```

### Provider failure

```text
AIProviderError
```

### Invalid model output

```text
AIResponseParseError
```

The shared AI layer handles provider reliability while the Post Assistant handles feature-specific output validation.

---

# 37. Error Flow

```text
                    Request
                       |
                       v
                Request Validation
                       |
              +--------+--------+
              |                 |
           Invalid            Valid
              |                 |
              v                 v
          HTTP 400          AIService
                                |
                                v
                       TextGenerationService
                                |
                 +--------------+--------------+
                 |              |              |
               Timeout       Provider       Success
                 |              |              |
                 v              v              v
             504 Error      502 Error       AI Text
                                                |
                                                v
                                           JSON Parsing
                                                |
                                         +------+------+
                                         |             |
                                      Invalid        Valid
                                         |             |
                                         v             v
                                      Parse Error   Zod Validation
```

---

# 38. Testing

The feature currently has dedicated service-level tests.

The `AIService` tests cover:

```text
✓ Valid JSON
✓ Invalid JSON
✓ Valid JSON with invalid schema
✓ TextGenerationService error propagation
```

This ensures the feature does not blindly trust model output.

The lower-level `TextGenerationService` tests separately cover:

```text
✓ Successful generation
✓ AI disabled
✓ Unexpected provider error
✓ Timeout
✓ Retry on transient 503
✓ No retry on non-transient error
```

This separation keeps Post Assistant tests focused on feature behavior.

---

# 39. Testing Strategy

The Post Assistant does not need Gemini to be available for normal unit tests.

The dependency chain can be controlled:

```text
AIService
    |
    v
Mock TextGenerationService
    |
    v
Controlled AI response
```

This allows deterministic tests for:

- valid output,
- malformed output,
- invalid schema,
- provider failures.

Real Gemini calls are used separately for integration/manual verification.

---

# 40. Example Test Scenarios

### Scenario 1 — Successful response

```text
Mock AI response
      |
      v
Valid JSON
      |
      v
Valid Zod schema
      |
      v
PostAssistantResponse
```

Expected:

```text
Success
```

### Scenario 2 — Invalid JSON

```text
Mock AI response
      |
      v
Malformed JSON
      |
      v
JSON.parse fails
      |
      v
AIResponseParseError
```

### Scenario 3 — Wrong structure

```text
Mock AI response
      |
      v
Valid JSON
      |
      v
Invalid Zod schema
      |
      v
AIResponseParseError
```

---

# 41. Configuration Used by the Feature

The Post Assistant depends on shared AI configuration.

Important configuration values include:

```env
AI_ENABLED=true
AI_PROVIDER=gemini
AI_MODEL=gemini-3.5-flash-lite
AI_TIMEOUT_MS=60000
AI_MAX_INPUT_CHARS=12000
AI_MAX_OUTPUT_TOKENS=1000
AI_MAX_RETRIES=2
```

The API key is also required for the Gemini provider but is intentionally not documented here as a value.

Secrets belong in environment configuration and should never be committed to the repository.

---

# 42. Model Selection

The Post Assistant does not hard-code the Gemini model inside the feature.

Instead:

```text
AIService
    |
    v
TextGenerationService
    |
    v
GeminiProvider
    |
    v
env.AI_MODEL
```

This means the feature is independent of a specific model.

The current configured model is:

```text
gemini-3.5-flash-lite
```

This was selected after the initially tested model encountered provider-side availability/high-demand failures.

The provider-selection details belong in:

```text
03-AI-Provider-Selection.md
```

rather than being duplicated here.

---

# 43. Why Post Assistant Uses Synchronous Processing

The current request expects an immediate response:

```text
Request
   |
   v
Generate suggestions
   |
   v
Response
```

This is appropriate because the user is actively waiting for the suggestions.

An asynchronous architecture would instead require:

```text
Request
   |
   v
Queue
   |
   v
Worker
   |
   v
AI
   |
   v
Store Result
   |
   v
Client polls / receives event
```

That complexity is unnecessary for the current Post Assistant MVP.

---

# 44. Synchronous vs Asynchronous Boundary

The current feature is therefore:

```text
Post Assistant
      |
      v
Synchronous AI
```

Future embedding generation for Semantic Search is better suited to:

```text
Post Published
      |
      v
BullMQ
      |
      v
AI Worker
      |
      v
Embedding
```

This distinction is important because not every AI workload should use the same execution model.

---

# 45. Security Considerations

The feature should only send data that is necessary for generating the suggestions.

The current request contains:

```text
title
content
instruction
```

The implementation should not intentionally send:

- passwords,
- authentication tokens,
- API keys,
- unrelated private application data.

The Gemini API key itself remains server-side.

The client communicates with:

```text
WriteSpace API
```

rather than directly with Gemini.

---

# 46. Why the Client Does Not Call Gemini Directly

The architecture is:

```text
Client
   |
   v
WriteSpace Backend
   |
   v
Gemini
```

rather than:

```text
Client
   |
   v
Gemini
```

This keeps the provider credential on the server and allows the backend to control:

- validation,
- provider selection,
- timeouts,
- retries,
- error normalization,
- output validation,
- future provider switching.

---

# 47. Provider Independence

The Post Assistant depends on:

```text
AIProvider
```

rather than directly on:

```text
GeminiProvider
```

Therefore the feature does not need to know whether the underlying provider is:

```text
Gemini
OpenAI
Groq
Mock
Future provider
```

The feature only asks the shared service to generate text.

This is one of the major architectural benefits of the AI foundation.

---

# 48. Current Limitations

The current Post Assistant intentionally has several limitations.

### 1. No streaming

The entire AI response is generated before returning the HTTP response.

### 2. No AI suggestion history

Generated suggestions are not persisted.

### 3. No regeneration endpoint

The current feature exposes one generation endpoint rather than a dedicated regeneration/history workflow.

### 4. No model comparison

Only the configured provider/model is used.

### 5. No AI quality evaluation framework

The application validates structure but does not quantitatively evaluate content quality.

### 6. No dedicated AI rate limiter

The current AI route does not have a dedicated `apiLimiter` attached.

### 7. No moderation layer

The current feature does not implement a separate AI content-moderation workflow.

These are limitations of the current MVP, not missing requirements that the architecture must immediately solve.

---

# 49. Future Improvements

Potential future improvements include:

### Better structured output

Use provider-supported structured output capabilities where appropriate rather than relying only on prompt instructions plus JSON parsing.

### Streaming

Stream suggestions to the client if the user experience benefits from incremental output.

### Regeneration

Allow the user to request another suggestion.

### Editing workflow

Allow users to apply an AI-generated title/summary/topics directly into the post editor.

### AI history

Persist selected AI interactions if product requirements justify it.

### Usage tracking

Track AI usage if cost/quotas become operational concerns.

### Quality evaluation

Introduce a dataset for evaluating suggestion quality.

These are future improvements rather than current implementation.

---

# 50. Important Design Decision: Suggestions, Not Automatic Changes

One of the most important product/engineering decisions is:

> **The AI Post Assistant generates suggestions but does not automatically modify the user's post.**

This provides a clear boundary between:

```text
AI-generated suggestion
```

and:

```text
User-owned application data
```

It also reduces the risk of:

- accidentally overwriting content,
- publishing incorrect AI-generated information,
- introducing unexpected database mutations.

---

# 51. Important Design Decision: No Persistence

Another deliberate decision is:

> **Do not persist AI suggestions until there is a concrete product requirement for AI history or analytics.**

The feature is useful without introducing a new database model.

This follows the broader MVP principle:

```text
Build the smallest useful feature
        +
Keep the architecture extensible
        =
Avoid premature infrastructure
```

---

# 52. Important Design Decision: Feature Layer Owns the Prompt

The prompt is part of the Post Assistant feature.

Therefore:

```text
AIService
    |
    +--> buildPostAssistantPrompt()
```

rather than:

```text
GeminiProvider
    |
    +--> buildPostAssistantPrompt()
```

This means provider infrastructure remains generic.

If the provider changes later, the Post Assistant prompt does not need to move with it.

---

# 53. Important Design Decision: Validate Both Sides

The feature validates:

### Input

```text
Client
  |
  v
Zod
```

### Output

```text
AI
  |
  v
JSON.parse
  |
  v
Zod
```

Therefore both boundaries are controlled:

```text
Untrusted Client Input
        |
        v
Validation
        |
        v
AI System
        |
        v
Untrusted AI Output
        |
        v
Validation
        |
        v
Application Response
```

This is one of the strongest engineering aspects of the implementation.

---

# 54. End-to-End Example

Suppose the user submits:

```json
{
  "title": "Understanding Redis Caching",
  "content": "Redis is an in-memory data store commonly used for caching frequently accessed data. It can improve application performance by reducing repeated database queries.",
  "instruction": "Make the suggestions suitable for backend developers."
}
```

The application performs:

```text
1. Receive HTTP request
        |
2. Validate request
        |
3. Build Post Assistant prompt
        |
4. Call TextGenerationService
        |
5. Check AI_ENABLED
        |
6. Apply timeout
        |
7. Call GeminiProvider
        |
8. Gemini generates text
        |
9. Parse JSON
        |
10. Validate response schema
        |
11. Return structured response
```

Final result:

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

---

# 55. Responsibility Map

| Component                     | Responsibility                          |
| ----------------------------- | --------------------------------------- |
| `ai.routes.ts`                | Defines `/post-assistant` endpoint      |
| `AIController`                | HTTP request/response handling          |
| `postAssistantRequestSchema`  | Validates incoming request              |
| `AIService`                   | Implements Post Assistant feature       |
| `buildPostAssistantPrompt()`  | Builds feature-specific prompt          |
| `TextGenerationService`       | Handles shared AI execution/reliability |
| `AIProvider`                  | Defines provider contract               |
| `GeminiProvider`              | Calls Gemini                            |
| `JSON.parse()`                | Parses generated JSON                   |
| `postAssistantResponseSchema` | Validates generated structure           |
| `AIResponseParseError`        | Represents invalid model output         |

---

# 56. Files Involved

The primary implementation is distributed across the AI feature and shared AI infrastructure.

Conceptually:

```text
src/
└── modules/
    └── ai/
        ├── ai.routes.ts
        ├── controllers/
        │   └── ai.controller.ts
        ├── dto/
        │   └── post-assistant.dto.ts
        └── services/
            └── ai.service.ts

src/
└── shared/
    └── ai/
        ├── errors/
        │   └── ai.errors.ts
        ├── providers/
        │   ├── ai.provider.ts
        │   ├── ai-provider.factory.ts
        │   ├── gemini.provider.ts
        │   └── mock.provider.ts
        └── services/
            └── text-generation.service.ts
```

The exact repository aliases/import paths may differ, but the architectural separation is the important part.

---

# 57. Interview Explanation

A strong interview explanation would be:

> "The first AI feature I implemented in WriteSpace is a Post Assistant. It takes a draft title, content and an optional instruction and generates a suggested title, summary and technical topics. I kept the feature synchronous because the user needs the result immediately.
>
> The controller validates the request using Zod and delegates the feature logic to `AIService`. `AIService` constructs the feature-specific prompt and calls a shared `TextGenerationService`. That service handles provider selection, timeout and retry behavior, so the feature itself doesn't need to know about Gemini.
>
> The model is asked to return JSON, but I don't blindly trust the model output. I first parse the response with `JSON.parse()` and then validate the resulting object using a Zod response schema. If either step fails, the application returns an AI response parsing error.
>
> I also deliberately don't persist the generated suggestions. They are suggestions for the user, not authoritative post data. This allowed me to introduce the feature without adding an AI-specific database model."

---

# 58. Likely Interview Questions

## Q1. Why did you create an AI Post Assistant?

**Concept:** Product reasoning / AI integration

It provides a practical AI feature for technical bloggers by generating metadata from existing content without changing the user's original post.

---

## Q2. Why is the endpoint synchronous?

**Concept:** Request lifecycle / synchronous processing

The user is actively waiting for suggestions, so returning the result in the same request is simpler and provides immediate feedback.

---

## Q3. Why don't you save the AI-generated result?

**Concept:** Data modeling / MVP design

The result is a temporary suggestion. Persisting it would require additional schema and lifecycle decisions without providing enough value for the initial MVP.

---

## Q4. Why do you validate AI output?

**Concept:** Defensive programming

AI output is an external dependency and is not guaranteed to follow the requested format. The application therefore treats it as untrusted input.

---

## Q5. Why use both `JSON.parse()` and Zod?

**Concept:** Serialization / schema validation

`JSON.parse()` verifies JSON syntax. Zod verifies that the parsed object satisfies the application's expected contract.

---

## Q6. Why isn't the prompt inside `GeminiProvider`?

**Concept:** Separation of concerns

The prompt is feature-specific, while the provider should remain generic. Keeping the prompt in `AIService` allows the provider to be replaced without changing feature logic.

---

## Q7. What happens if Gemini returns invalid JSON?

**Concept:** Error handling

`JSON.parse()` throws, the service converts that into `AIResponseParseError`, and the error propagates through the application's normal error-handling pipeline.

---

## Q8. What happens if Gemini is temporarily unavailable?

**Concept:** Reliability

`TextGenerationService` classifies transient provider failures such as `503`, retries them using exponential backoff, and eventually returns a normalized provider error if retries are exhausted.

---

## Q9. Why doesn't the frontend call Gemini directly?

**Concept:** Backend security / architecture

The backend owns provider credentials and centralizes validation, timeout, retries, provider selection and output validation.

---

## Q10. How would you scale this feature?

**Concept:** Scalability

For synchronous requests, the main concerns would be concurrency, provider rate limits, request timeouts and application-level rate limiting. If a future AI operation becomes long-running, it could be moved to the existing BullMQ infrastructure.

---

# 59. Current Implementation Status

### Implemented

```text
✓ Post Assistant endpoint
✓ Request validation
✓ Optional title
✓ Required content
✓ Optional instruction
✓ Configurable input limit
✓ Feature-specific prompt
✓ System instruction
✓ Gemini provider integration
✓ Shared AI service
✓ Timeout
✓ Retry
✓ Structured JSON output
✓ JSON parsing
✓ Zod response validation
✓ AI-specific errors
✓ Unit tests
✓ Real endpoint verification
```

### Not implemented

```text
✗ AI suggestion persistence
✗ AI history
✗ Regeneration workflow
✗ Streaming
✗ AI quality evaluation
✗ Dedicated AI rate limiter
✗ Automatic post modification
✗ Automatic publishing
```

---

# 60. Relationship With Other AI Documentation

This feature document should be read together with the shared AI documentation.

```text
01-AI-Overview.md
        |
        v
02-AI-Architecture.md
        |
        v
03-AI-Provider-Selection.md
        |
        v
04-AI-Configuration.md
        |
        v
05-AI-Provider-Layer.md
        |
        v
06-AI-Service-Layer.md
        |
        v
07-AI-Request-Lifecycle.md
        |
        v
08-AI-Error-Handling.md
        |
        v
09-AI-Reliability.md
        |
        v
10-AI-Testing.md
        |
        v
features/
    |
    v
01-AI-Post-Assistant.md
```

The previous documents explain the reusable AI foundation.

This document explains how the first actual AI feature uses that foundation.

---

# 61. Final Summary

The AI Post Assistant is intentionally a small but complete AI feature.

It demonstrates the complete path from:

```text
HTTP Request
     |
     v
Validation
     |
     v
Feature Service
     |
     v
Shared AI Service
     |
     v
Provider Abstraction
     |
     v
Gemini
     |
     v
Structured AI Output
     |
     v
Validation
     |
     v
HTTP Response
```

The most important engineering decisions are:

1. **Keep the feature synchronous** because the user expects an immediate result.
2. **Keep the prompt inside the feature layer** because it is feature-specific.
3. **Use a provider abstraction** so the feature is not coupled to Gemini.
4. **Validate both input and output** because both the client and AI provider are external boundaries.
5. **Do not persist suggestions in the MVP** because they are user-controlled recommendations rather than authoritative data.
6. **Reuse the shared reliability layer** for timeout, retries and provider errors.
7. **Use deterministic mocks for unit tests** rather than depending on the real AI provider.

This makes the Post Assistant a useful first AI feature while keeping the WriteSpace AI architecture ready for additional features such as Semantic Search.
