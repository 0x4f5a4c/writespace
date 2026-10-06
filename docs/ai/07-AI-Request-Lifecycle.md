# AI Request Lifecycle

## 1. Purpose

This document explains the complete lifecycle of an AI request in WriteSpace.

The goal is to understand what happens from the moment a client sends an AI request until the final response is returned.

The current AI feature used to demonstrate this lifecycle is:

```text
AI Post Assistant
```

The endpoint is:

```text
POST /api/v1/ai/post-assistant
```

The complete lifecycle is:

```text
Client
  ↓
Express Router
  ↓
AIController
  ↓
Request Validation
  ↓
AIService
  ↓
TextGenerationService
  ↓
AIProvider
  ↓
GeminiProvider
  ↓
Gemini SDK
  ↓
Gemini API
  ↓
AI Response
  ↓
TextGenerationService
  ↓
AIService
  ↓
Response Parsing
  ↓
Response Validation
  ↓
AIController
  ↓
HTTP Response
```

---

# 2. High-Level Request Flow

A simplified version of the current architecture is:

```text
                  ┌──────────────────────┐
                  │       Client         │
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │    AI Route          │
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │    AI Controller     │
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │    Zod Validation    │
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │      AIService       │
                  └──────────┬───────────┘
                             │
                             ▼
              ┌──────────────────────────────┐
              │   TextGenerationService      │
              │                              │
              │ • AI enabled?                │
              │ • timeout                    │
              │ • retry                      │
              │ • backoff                    │
              │ • error handling              │
              └──────────────┬───────────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │     AIProvider       │
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │   GeminiProvider     │
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │    Gemini API        │
                  └──────────┬───────────┘
                             │
                             ▼
                       AI Response
                             │
                             ▼
                  ┌──────────────────────┐
                  │     AIService        │
                  │ Parse + Validate     │
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │    AIController      │
                  └──────────┬───────────┘
                             │
                             ▼
                         Client
```

---

# 3. Step 1 — Client Sends Request

The lifecycle starts when the client requests AI assistance.

Current endpoint:

```text
POST /api/v1/ai/post-assistant
```

Example request:

```json
{
  "title": "Understanding Redis Caching",
  "content": "Redis is an in-memory data store commonly used for caching frequently accessed data. It can improve application performance by reducing repeated database queries.",
  "instruction": "Make the suggestions suitable for backend developers."
}
```

The request contains:

- optional post title
- required post content
- optional additional instruction

The client does not need to know:

- which AI provider is being used
- which model is being used
- how retries work
- how timeout is implemented
- how the prompt is constructed
- how Gemini is called

Those are backend responsibilities.

---

# 4. Step 2 — Express Route

The route is defined in:

```text
src/modules/ai/ai.routes.ts
```

Current implementation:

```ts
import { Router } from "express";
import { aiController } from "./controllers/ai.controller";

const router = Router();

router.post(
  "/post-assistant",
  aiController.generatePostAssistant.bind(aiController),
);

export default router;
```

The route maps:

```text
POST /post-assistant
```

to:

```ts
aiController.generatePostAssistant;
```

The application's main router mounts the AI routes under:

```ts
app.use("/api/v1/ai", aiRoutes);
```

Therefore the final endpoint becomes:

```text
POST /api/v1/ai/post-assistant
```

---

# 5. Step 3 — Controller Receives the Request

The request reaches:

```text
src/modules/ai/controllers/ai.controller.ts
```

The controller method is:

```ts
public async generatePostAssistant(
  req: Request,
  res: Response,
): Promise<void> {
  ...
}
```

The controller is responsible for the HTTP boundary.

Its responsibilities include:

- receiving the Express request
- validating the request body
- calling the AI service
- returning the HTTP response

It does not know how Gemini works.

---

# 6. Step 4 — Request Validation

The controller validates the incoming request:

```ts
const validatedRequest = postAssistantRequestSchema.safeParse(req.body);
```

The schema is defined in:

```text
src/modules/ai/dto/post-assistant.dto.ts
```

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

---

# 7. Why Validate Before Calling AI?

Validation happens before the AI provider is called.

This is important because sending invalid input to an external AI service could:

- waste API usage
- increase latency
- produce unpredictable results
- unnecessarily consume provider quota

Therefore:

```text
HTTP Request
     ↓
Validate
     ↓
Valid?
 ├── No → 400
 │
 └── Yes
       ↓
     AI Service
```

---

# 8. Invalid Request Flow

If validation fails:

```ts
if (!validatedRequest.success) {
  res.status(HTTP_STATUS.BAD_REQUEST).json({
    status: "fail",
    message: "Invalid post assistant request",
    errors: validatedRequest.error.flatten(),
  });

  return;
}
```

The request ends here.

The AI provider is never called.

For example, if `content` is missing:

```text
Client
  ↓
Controller
  ↓
Zod validation
  ↓
Validation failed
  ↓
HTTP 400
```

This is an important cost-control and correctness boundary.

---

# 9. Step 5 — AIService Is Called

For a valid request, the controller calls:

```ts
const result = await aiService.generatePostAssistant(validatedRequest.data);
```

The controller passes validated data rather than the original unvalidated `req.body`.

This means the service receives:

```text
PostAssistantRequest
```

that has already passed the DTO validation layer.

---

# 10. Step 6 — AIService Builds the Prompt

The feature-specific service is:

```text
src/modules/ai/services/ai.service.ts
```

The main method is:

```ts
public async generatePostAssistant(
  request: PostAssistantRequest,
): Promise<PostAssistantResponse> {
  ...
}
```

It first builds a feature-specific prompt:

```ts
const prompt = this.buildPostAssistantPrompt(request);
```

The prompt contains:

- post title
- post content
- additional instruction
- expected JSON structure
- output requirements

The important architectural point is:

> `AIService` decides what the model should be asked to do.

It does not decide how to communicate with Gemini.

---

# 11. Step 7 — System Instruction

The AI service sends a system instruction:

```ts
systemInstruction:
  "You are an AI writing assistant for a technical blogging platform. Return only valid JSON matching the requested structure.",
```

This establishes the model's expected role and output behavior.

The service then calls:

```ts
const response = await this.textGenerationService.generate({
  prompt,
  systemInstruction,
});
```

At this point, control moves from the feature layer into the shared AI infrastructure.

---

# 12. Step 8 — TextGenerationService

The request enters:

```text
src/shared/ai/services/text-generation.service.ts
```

The public method is:

```ts
public async generate(
  request: AITextGenerationRequest,
): Promise<AITextGenerationResponse>
```

This is the central execution point for generic text generation.

The service handles:

```text
AI enabled check
        ↓
logging
        ↓
retry policy
        ↓
timeout
        ↓
provider invocation
        ↓
error normalization
```

---

# 13. Step 9 — AI Feature Flag Check

The first check is:

```ts
if (!env.AI_ENABLED) {
  throw new AIDisabledError();
}
```

If:

```env
AI_ENABLED=false
```

the provider is never called.

The request ends with an application-level AI-disabled error.

The flow is:

```text
AIService
   ↓
TextGenerationService
   ↓
AI_ENABLED?
   │
   ├── false
   │    ↓
   │  AIDisabledError
   │
   └── true
        ↓
      Continue
```

---

# 14. Step 10 — Retry Wrapper

If AI is enabled, the service calls:

```ts
const response = await this.generateWithRetry(request);
```

The retry wrapper is responsible for determining whether a failed provider request should be repeated.

The important point is:

```text
generate()
    ↓
generateWithRetry()
```

rather than directly:

```text
generate()
    ↓
provider.generateText()
```

This allows retry behavior to be centralized.

---

# 15. Step 11 — Timeout Wrapper

Inside `generateWithRetry()`, each individual attempt calls:

```ts
return await this.generateWithTimeout(request);
```

The timeout wrapper creates:

```ts
const controller = new AbortController();
```

and:

```ts
const timeout = setTimeout(() => {
  controller.abort();
}, env.AI_TIMEOUT_MS);
```

The timeout is therefore applied to each provider attempt.

---

# 16. Step 12 — Provider Request

The provider receives:

```ts
return await this.provider.generateText({
  ...request,
  signal: controller.signal,
});
```

At this point the generic request becomes:

```text
AITextGenerationRequest
```

The actual implementation depends on the provider selected by configuration.

Current production provider:

```text
GeminiProvider
```

---

# 17. Step 13 — GeminiProvider

The provider implementation is:

```text
src/shared/ai/providers/gemini.provider.ts
```

It calls:

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

The provider translates the application's generic request into Gemini-specific SDK configuration.

---

# 18. Step 14 — Gemini SDK

The provider uses:

```ts
import { GoogleGenAI } from "@google/genai";
```

The client was initialized using:

```ts
this.client = new GoogleGenAI({
  apiKey: env.GEMINI_API_KEY,
});
```

The actual external operation is:

```ts
this.client.models.generateContent(...)
```

Therefore the final provider-side flow is:

```text
TextGenerationService
        ↓
AIProvider
        ↓
GeminiProvider
        ↓
GoogleGenAI
        ↓
Gemini API
```

---

# 19. Step 15 — Gemini Generates the Response

Gemini processes the supplied:

```text
prompt
system instruction
model configuration
output token limit
```

and returns a provider-specific response.

The provider does not return the complete Gemini SDK response to the application.

Instead it normalizes the result.

---

# 20. Step 16 — Gemini Response Normalization

The provider returns:

```ts
return {
  text: response.text ?? "",
};
```

Therefore the rest of the application receives:

```ts
AITextGenerationResponse;
```

with:

```ts
{
  text: string;
}
```

The provider-specific SDK structure does not leak into `AIService`.

This maintains the provider abstraction.

---

# 21. Step 17 — Successful Return to TextGenerationService

After the provider returns successfully:

```text
Gemini
  ↓
GeminiProvider
  ↓
AITextGenerationResponse
  ↓
TextGenerationService
```

The service records the duration:

```ts
const duration = Date.now() - startTime;
```

and logs:

```ts
logger.info(`[AI] Text generation completed in ${duration}ms`);
```

Then it returns the response:

```ts
return response;
```

---

# 22. Step 18 — What Happens if Gemini Fails?

The lifecycle changes depending on the failure.

There are three important cases.

### Case 1 — Retryable provider error

```text
503
```

or:

```text
429
```

The service retries according to the configured retry policy.

### Case 2 — Timeout

The `AbortController` aborts the request.

The service creates:

```text
AITimeoutError
```

and currently does not retry it.

### Case 3 — Non-retryable provider error

The error is propagated and eventually normalized as:

```text
AIProviderError
```

The complete failure lifecycle is therefore:

```text
Provider
   ↓
Error
   ↓
TextGenerationService
   ↓
Classify
   ├── retryable → retry
   ├── timeout → AITimeoutError
   └── non-retryable → AIProviderError
```

---

# 23. Step 19 — Return to AIService

Once `TextGenerationService` successfully returns:

```ts
AITextGenerationResponse;
```

control returns to:

```text
AIService.generatePostAssistant()
```

The response contains:

```ts
{
  text: string;
}
```

At this stage the text is still just raw model output.

The AI feature has not yet accepted it as valid structured data.

---

# 24. Step 20 — Parse AI Response

The AI service calls:

```ts
const parsedResponse = this.parseAIResponse(response.text);
```

The implementation is:

```ts
private parseAIResponse(
  text: string,
): unknown {
  try {
    return JSON.parse(text);
  } catch {
    logger.error(
      "[AI] Post assistant returned invalid JSON",
    );

    throw new AIResponseParseError();
  }
}
```

The AI model was instructed to return JSON, but the application does not blindly trust that instruction.

It parses and validates the result.

---

# 25. Why Parse the Response?

AI output is generated content.

Even if the prompt says:

```text
Return ONLY valid JSON
```

the application should not assume that the model will always comply perfectly.

For example, the model could potentially return:

```text
Here is the JSON:
{
  ...
}
```

or malformed JSON.

Therefore the backend treats model output as untrusted external data.

The flow is:

```text
AI Output
   ↓
JSON.parse()
   ↓
Valid JSON?
 ├── No → AIResponseParseError
 └── Yes
```

---

# 26. Step 21 — Response Schema Validation

After parsing:

```ts
const validatedResponse = postAssistantResponseSchema.safeParse(parsedResponse);
```

The response schema is:

```ts
export const postAssistantResponseSchema = z.object({
  suggestedTitle: z.string().min(1),
  summary: z.string().min(1),
  topics: z.array(z.string()).min(1),
});
```

This validates the semantic structure of the response.

---

# 27. Why Parse and Validate Separately?

These are two different checks.

### JSON parsing

Answers:

> Is this valid JSON?

### Schema validation

Answers:

> Is this valid Post Assistant data?

For example:

```json
{
  "hello": "world"
}
```

is valid JSON.

But it is not a valid Post Assistant response because it does not contain:

```text
suggestedTitle
summary
topics
```

Therefore:

```text
Raw AI output
      ↓
JSON.parse()
      ↓
Valid JSON
      ↓
Zod schema validation
      ↓
Valid feature response
```

---

# 28. Invalid Structured Response

If the schema validation fails:

```ts
if (!validatedResponse.success) {
  logger.error(
    `[AI] Post assistant returned invalid structured data: ${validatedResponse.error.message}`,
  );

  throw new AIResponseParseError();
}
```

The AI service therefore does not return malformed or incomplete AI output to the client.

This creates a second safety boundary after the provider layer.

---

# 29. Step 22 — Validated Feature Response

If validation succeeds:

```ts
return validatedResponse.data;
```

The AI service now returns a strongly validated:

```ts
PostAssistantResponse;
```

containing:

```json
{
  "suggestedTitle": "...",
  "summary": "...",
  "topics": ["...", "..."]
}
```

At this point the AI-generated data has passed:

```text
Provider response
      ↓
JSON parsing
      ↓
Schema validation
```

---

# 30. Step 23 — Return to Controller

The controller receives:

```ts
const result = await aiService.generatePostAssistant(validatedRequest.data);
```

and returns:

```ts
res.status(HTTP_STATUS.OK).json({
  status: "success",
  data: result,
});
```

The final response therefore follows the application's normal API response structure.

---

# 31. Example Successful Response

The current endpoint can return:

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

The important point is that this response is not simply the raw Gemini response.

It has passed through the application-level parsing and validation layer.

---

# 32. Complete Successful Lifecycle

The complete successful request can now be summarized as:

```text
1. Client
   │
   │ POST /api/v1/ai/post-assistant
   ▼
2. Express Router
   │
   ▼
3. AIController
   │
   ▼
4. Zod Request Validation
   │
   │ valid
   ▼
5. AIService
   │
   │ build prompt
   ▼
6. TextGenerationService
   │
   │ AI enabled
   ▼
7. Retry Wrapper
   │
   ▼
8. Timeout Wrapper
   │
   ▼
9. AIProvider
   │
   ▼
10. GeminiProvider
   │
   ▼
11. Gemini SDK
   │
   ▼
12. Gemini API
   │
   ▼
13. Generated Text
   │
   ▼
14. GeminiProvider
   │
   │ normalize response
   ▼
15. TextGenerationService
   │
   ▼
16. AIService
   │
   │ JSON.parse()
   ▼
17. Zod Response Validation
   │
   │ valid
   ▼
18. AIController
   │
   ▼
19. HTTP 200 Response
   │
   ▼
20. Client
```

---

# 33. Complete Failure Lifecycle

A failure can occur at several different points.

```text
Client
  ↓
Controller
  ↓
Request Validation
  │
  ├── invalid → 400
  │
  └── valid
       ↓
    AIService
       ↓
    TextGenerationService
       │
       ├── AI disabled → AI disabled error
       │
       └── Provider request
              │
              ├── timeout → AITimeoutError
              │
              ├── 408/429/5xx
              │       ↓
              │     retry
              │
              └── other provider error
                      ↓
                 AIProviderError

Provider success
       ↓
AIService
       ↓
JSON parsing
       │
       ├── invalid JSON
       │      ↓
       │ AIResponseParseError
       │
       └── valid JSON
              ↓
       Response schema validation
              │
              ├── invalid
              │     ↓
              │ AIResponseParseError
              │
              └── valid
                    ↓
                 HTTP 200
```

---

# 34. Three Validation Boundaries

The current AI architecture has multiple validation boundaries.

### Boundary 1 — HTTP input

```text
Client
  ↓
Zod Request Schema
```

Protects the backend from invalid client input.

### Boundary 2 — Provider abstraction

```text
Application
  ↓
AIProvider
```

Protects the application from provider-specific implementation details.

### Boundary 3 — AI output

```text
AI Output
  ↓
JSON.parse()
  ↓
Zod Response Schema
```

Protects the application from malformed or structurally invalid model output.

This layered validation is important because AI output should be treated as untrusted external data.

---

# 35. Why the AI Model Is Not Trusted

The application provides instructions such as:

```text
Return ONLY valid JSON
```

but the backend does not treat that instruction as a guarantee.

The model is still an external system whose output must be validated.

Therefore:

```text
Prompt instruction
        ≠
Backend guarantee
```

The backend creates the actual guarantee through:

```text
JSON parsing
+
Zod validation
```

This is an important engineering principle.

---

# 36. Separation Between Request and Response Validation

The request schema:

```text
PostAssistantRequest
```

protects the AI provider from invalid input.

The response schema:

```text
PostAssistantResponse
```

protects the client from invalid AI output.

Therefore:

```text
Client Input
     ↓
Request Validation
     ↓
AI
     ↓
Response Validation
     ↓
Client Output
```

The AI sits between two validation boundaries.

---

# 37. Configuration Participation in the Lifecycle

Several environment variables influence the request lifecycle.

```text
AI_ENABLED
    ↓
Whether AI execution is allowed

AI_PROVIDER
    ↓
Which provider is instantiated

AI_MODEL
    ↓
Which Gemini model is used

AI_MAX_INPUT_CHARS
    ↓
Maximum accepted request content

AI_MAX_OUTPUT_TOKENS
    ↓
Maximum generated output

AI_TIMEOUT_MS
    ↓
Provider attempt timeout

AI_MAX_RETRIES
    ↓
Maximum retry attempts
```

Therefore configuration is not isolated from execution.

It directly controls runtime behavior.

---

# 38. Request Lifecycle With Configuration

A more complete view is:

```text
                     Environment
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
   AI_ENABLED        AI_PROVIDER        AI_MODEL
        │                 │                 │
        ▼                 ▼                 ▼
 TextGeneration       Factory          GeminiProvider
   Service
        │
        ├── AI_TIMEOUT_MS
        ├── AI_MAX_RETRIES
        └── AI_MAX_OUTPUT_TOKENS
```

This demonstrates why centralized configuration is important.

---

# 39. Retry Lifecycle Example

Assume:

```env
AI_MAX_RETRIES=2
```

and Gemini returns `503`.

The lifecycle becomes:

```text
Initial Request
      ↓
Gemini
      ↓
503
      ↓
Retryable?
      ↓
YES
      ↓
Wait 1000ms
      ↓
Retry #1
      ↓
Gemini
      ↓
503
      ↓
Retryable?
      ↓
YES
      ↓
Wait 2000ms
      ↓
Retry #2
      ↓
Gemini
      ↓
Success
```

The successful response then travels back through:

```text
GeminiProvider
      ↓
TextGenerationService
      ↓
AIService
      ↓
Response validation
      ↓
Controller
      ↓
Client
```

---

# 40. Timeout Lifecycle Example

Assume:

```env
AI_TIMEOUT_MS=60000
```

If the provider does not complete within the configured timeout:

```text
Request
  ↓
AbortController created
  ↓
Gemini request
  ↓
60 seconds
  ↓
controller.abort()
  ↓
AbortSignal
  ↓
Provider/SDK cancellation
  ↓
AITimeoutError
  ↓
TextGenerationService
  ↓
Controller / error middleware
```

The request does not remain pending indefinitely.

---

# 41. Provider Selection During the Lifecycle

The provider is selected before the request reaches the external AI service.

Configuration:

```env
AI_PROVIDER=gemini
```

leads to:

```text
createAIProvider()
       ↓
AI_PROVIDER = gemini
       ↓
new GeminiProvider()
```

If:

```env
AI_PROVIDER=mock
```

is used:

```text
createAIProvider()
       ↓
AI_PROVIDER = mock
       ↓
new MockAIProvider()
```

The rest of the lifecycle remains unchanged.

This demonstrates the value of the provider abstraction.

---

# 42. Mock Lifecycle

With the mock provider:

```text
Client
  ↓
Controller
  ↓
AIService
  ↓
TextGenerationService
  ↓
MockAIProvider
  ↓
Deterministic response
  ↓
AIService parsing
  ↓
Validation
  ↓
Controller
  ↓
Client
```

No external Gemini API call is required.

This is particularly useful for automated testing.

---

# 43. Why the Controller Does Not Call Gemini

A controller could technically call the provider directly, but that would create too much responsibility at the HTTP layer.

For example:

```text
Controller
 ├── validation
 ├── prompt construction
 ├── Gemini SDK
 ├── timeout
 ├── retry
 ├── parsing
 └── response
```

This would make the controller difficult to test and maintain.

Instead:

```text
Controller
    ↓
AIService
    ↓
TextGenerationService
    ↓
Provider
```

Each layer has a clear responsibility.

---

# 44. Why AIService Does Not Call Gemini Directly

`AIService` contains feature-specific logic.

For example:

```text
What should a technical blog assistant return?
```

is a feature concern.

Whereas:

```text
How do I communicate with Gemini?
```

is a provider concern.

Keeping these separate means the feature can evolve independently from the provider.

---

# 45. Why the Provider Does Not Parse Post Assistant Output

The provider returns generic text:

```ts
{
  text: string;
}
```

It does not know that the text represents:

```text
suggestedTitle
summary
topics
```

That is specific to the Post Assistant feature.

Therefore parsing and feature-specific validation stay inside:

```text
AIService
```

This makes the provider reusable for future text-generation features.

---

# 46. End-to-End Responsibility Map

| Stage | Component             | Responsibility               |
| ----- | --------------------- | ---------------------------- |
| 1     | Client                | Send AI request              |
| 2     | Express route         | Route request                |
| 3     | Controller            | HTTP boundary                |
| 4     | Request DTO           | Validate input               |
| 5     | AIService             | Feature-specific logic       |
| 6     | TextGenerationService | AI execution + reliability   |
| 7     | Provider Factory      | Select provider              |
| 8     | AIProvider            | Generic provider contract    |
| 9     | GeminiProvider        | Gemini integration           |
| 10    | Gemini SDK            | SDK communication            |
| 11    | Gemini API            | Generate AI output           |
| 12    | GeminiProvider        | Normalize response           |
| 13    | TextGenerationService | Retry/timeout/error handling |
| 14    | AIService             | Parse AI output              |
| 15    | Response DTO          | Validate AI output           |
| 16    | Controller            | Return HTTP response         |

---

# 47. Interview Walkthrough

If an interviewer asks:

> "Walk me through what happens when a user requests AI assistance."

A strong answer would be:

> "The request first reaches the `/api/v1/ai/post-assistant` route and the controller validates the body using Zod. If the request is valid, the controller calls the AI feature service. The AI service constructs the feature-specific prompt and sends it to the shared `TextGenerationService`. That service first checks the AI feature flag, then applies timeout and retry policies before invoking the configured `AIProvider`. In the current implementation the provider is `GeminiProvider`, which translates the generic request into a Gemini SDK request. Gemini returns generated text, which is normalized by the provider and returned through the service layer. The AI feature service then parses the generated text as JSON and validates it against the Post Assistant response schema. Only after that validation does the controller return the final structured response to the client."

This answer demonstrates that you understand the complete system rather than only the individual files.

---

# 48. Important Interview Follow-Up Questions

### Why validate AI output?

Because model output is not guaranteed to follow the requested format. The backend treats it as untrusted external data and validates it before returning it.

### Why have both JSON parsing and Zod validation?

Parsing checks syntactic JSON validity. Zod checks whether the parsed object matches the application's expected structure.

### Where does retry happen?

Inside `TextGenerationService`, because retry is an application-level reliability concern.

### Where does prompt construction happen?

Inside the feature-specific `AIService`, because prompt content is part of the feature's business logic.

### Where does Gemini SDK knowledge exist?

Inside `GeminiProvider`.

### What happens if Gemini is unavailable?

Retryable errors such as `503` are retried with bounded exponential backoff. If retries are exhausted, the error is normalized and propagated.

### What happens if the AI request times out?

The `AbortController` aborts the request and the service raises `AITimeoutError`. The current implementation does not retry timeout errors.

### Can the provider be replaced?

Yes. A different implementation can satisfy `AIProvider` and be selected through the provider factory.

### Can AI be disabled without changing code?

Yes. `AI_ENABLED=false` disables AI execution through configuration.

---

# 49. Current Request Lifecycle

The current implemented lifecycle is:

```text
Client
  │
  │ POST /api/v1/ai/post-assistant
  ▼
Express Route
  │
  ▼
AIController
  │
  ├── Zod Request Validation
  │
  ▼
AIService
  │
  ├── Build Prompt
  ├── Add System Instruction
  │
  ▼
TextGenerationService
  │
  ├── AI Enabled Check
  ├── Start Timer
  ├── Retry Policy
  ├── Timeout
  │
  ▼
AIProvider
  │
  ▼
GeminiProvider
  │
  ├── Model
  ├── Prompt
  ├── System Instruction
  ├── Output Limit
  └── Abort Signal
  │
  ▼
Gemini SDK
  │
  ▼
Gemini API
  │
  ▼
Generated Text
  │
  ▼
GeminiProvider
  │
  └── Normalize → { text }
  │
  ▼
TextGenerationService
  │
  ├── Retry/Timeout/Error Handling
  │
  ▼
AIService
  │
  ├── JSON.parse()
  ├── Response Schema Validation
  │
  ▼
AIController
  │
  ▼
HTTP 200
  │
  ▼
Client
```

---

# 50. Current Status

The complete AI request lifecycle for the Post Assistant is **implemented and working end-to-end**.

Implemented:

```text
✓ AI route
✓ Controller
✓ Request DTO validation
✓ Feature service
✓ Prompt construction
✓ Shared text-generation service
✓ Feature flag
✓ Provider abstraction
✓ Gemini provider
✓ Gemini SDK integration
✓ Timeout
✓ Retry
✓ Exponential backoff
✓ Provider error normalization
✓ JSON response parsing
✓ Response schema validation
✓ HTTP response
✓ Automated service tests
✓ Automated AI feature service tests
```

The current endpoint has also been verified successfully with the configured Gemini model.

---

# 51. What Is Not Part of This Lifecycle Yet

The current lifecycle does not include:

```text
✗ Semantic search
✗ Embedding generation
✗ Vector database lookup
✗ Personalized recommendations
✗ User-interest profile
✗ AI-generated feed ranking
✗ AI moderation pipeline
✗ AI notification ranking
✗ AI-specific background worker
```

Those belong to future AI milestones.

In particular, Semantic Search will introduce a different lifecycle because embedding generation is expected to be asynchronous:

```text
Post Published
      ↓
BullMQ
      ↓
AI Worker
      ↓
Embedding Generation
      ↓
Vector Storage
```

That is intentionally separate from the current synchronous Post Assistant lifecycle.

---

# 52. Key Engineering Takeaways

The current AI request lifecycle demonstrates several important backend engineering principles:

### Validate at boundaries

```text
Client Input
   ↓
Zod
```

and:

```text
AI Output
   ↓
JSON.parse()
   ↓
Zod
```

### Separate feature logic from infrastructure

```text
AIService
   ↓
TextGenerationService
   ↓
AIProvider
```

### Treat external services as unreliable

The system expects:

```text
timeout
429
5xx
provider errors
```

rather than assuming every request succeeds.

### Bound retries

The system does not retry indefinitely.

### Normalize external dependencies

Provider-specific details stay behind the provider abstraction.

### Keep AI output untrusted

The model's requested format is not treated as a guarantee.

### Keep the HTTP layer thin

The controller coordinates the HTTP boundary instead of containing AI business logic.

---

# 53. Related Documentation

This document connects the previous architecture documents:

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
08-AI-Error-Handling.md
```

That document should go deeper into the AI error model and explain:

```text
AIDisabledError
AIProviderError
AITimeoutError
AIValidationError
AIResponseParseError
```

and, more importantly, **how an error travels from the provider or feature layer through WriteSpace's existing `AppError` and global error middleware to the final HTTP response**.
