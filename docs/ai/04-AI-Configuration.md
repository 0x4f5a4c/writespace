# AI Configuration

## 1. Purpose

The AI configuration layer centralizes all configuration required by the AI subsystem.

Instead of hardcoding values such as:

- whether AI is enabled
- which AI provider should be used
- which model should be used
- maximum input size
- maximum output tokens
- request timeout
- retry count
- Gemini API credentials

these values are loaded from environment variables and validated through the existing application configuration system.

This provides three important benefits:

1. **Security** — API credentials are not hardcoded in source code.
2. **Flexibility** — AI behavior can be changed without modifying application logic.
3. **Environment separation** — development, testing, and production can use different configurations.

---

# 2. Configuration Location

WriteSpace keeps application environment configuration in:

```text
src/config/env.ts
```

The actual values are supplied through environment variables, primarily using the `.env` file during local development.

The AI-related configuration currently consists of:

```env
AI_ENABLED=true
AI_PROVIDER=gemini
GEMINI_API_KEY=<secret>
AI_MODEL=gemini-3.5-flash-lite

AI_TIMEOUT_MS=60000
AI_MAX_INPUT_CHARS=12000
AI_MAX_OUTPUT_TOKENS=1000
AI_MAX_RETRIES=2
```

> The actual Gemini API key must never be documented or committed to the repository.

---

# 3. Why Environment-Based Configuration?

AI configuration contains values that may change independently of application code.

For example, changing:

```env
AI_MODEL=gemini-3.5-flash-lite
```

to another supported model should not require changing the provider implementation.

Similarly:

```env
AI_TIMEOUT_MS=60000
```

can be changed according to the environment without modifying `TextGenerationService`.

This follows the general principle:

> **Application code should define behavior, while environment configuration should define environment-specific values.**

---

# 4. AI Configuration Schema

The relevant configuration is validated in:

```text
src/config/env.ts
```

The current AI configuration is:

```ts
AI_ENABLED: z
  .enum(["true", "false"])
  .transform((value) => value === "true")
  .default("false"),

AI_PROVIDER: z
  .enum(["gemini", "mock"])
  .default("gemini"),

AI_MODEL: z
  .string()
  .min(1, "model name is required"),

GEMINI_API_KEY: z
  .string()
  .min(1, "gemini_api_key required"),

AI_MAX_OUTPUT_TOKENS: z
  .coerce
  .number()
  .int()
  .positive()
  .default(1000),

AI_TIMEOUT_MS: z
  .coerce
  .number()
  .int()
  .positive()
  .default(15000),

AI_MAX_RETRIES: z
  .coerce
  .number()
  .int()
  .min(0)
  .max(5)
  .default(2),

AI_MAX_INPUT_CHARS: z
  .coerce
  .number()
  .int()
  .positive()
  .default(12000),
```

The application therefore does not blindly trust values coming from environment variables.

Zod validates and transforms them before the rest of the application uses them.

---

# 5. Configuration Breakdown

## 5.1 `AI_ENABLED`

```env
AI_ENABLED=true
```

This acts as a feature flag for the AI subsystem.

It determines whether AI functionality is allowed to execute.

The value is converted from a string environment variable into a boolean:

```ts
AI_ENABLED: z
  .enum(["true", "false"])
  .transform((value) => value === "true")
  .default("false"),
```

Therefore:

```env
AI_ENABLED=true
```

becomes:

```ts
true;
```

and:

```env
AI_ENABLED=false
```

becomes:

```ts
false;
```

### Why use a feature flag?

The feature flag provides a simple operational kill switch.

For example, if the AI provider becomes unavailable or the feature needs to be temporarily disabled, AI functionality can be turned off without changing application code.

The `TextGenerationService` checks this value before making a provider request:

```ts
if (!env.AI_ENABLED) {
  throw new AIDisabledError();
}
```

This prevents disabled AI functionality from reaching Gemini.

---

# 6. `AI_PROVIDER`

```env
AI_PROVIDER=gemini
```

This determines which AI provider implementation should be created.

The allowed values are currently:

```ts
AI_PROVIDER: z.enum(["gemini", "mock"]).default("gemini"),
```

Currently supported providers are:

```text
gemini
mock
```

### `gemini`

Used for actual AI generation.

It creates:

```ts
new GeminiProvider();
```

### `mock`

Used primarily for automated testing.

It creates:

```ts
new MockAIProvider();
```

The provider factory is responsible for selecting the implementation:

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

This means application code does not need to know which concrete provider is being used.

---

# 7. `AI_MODEL`

```env
AI_MODEL=gemini-3.5-flash-lite
```

This specifies the model that the selected provider should use.

The model name is intentionally kept separate from the provider:

```text
AI_PROVIDER = gemini
AI_MODEL    = gemini-3.5-flash-lite
```

This distinction is important.

A **provider** identifies the external AI service.

A **model** identifies the specific model being used through that provider.

The Gemini provider reads the model from configuration:

```ts
const response = await this.client.models.generateContent({
  model: env.AI_MODEL,
  contents: request.prompt,
  ...
});
```

Therefore, the Gemini provider implementation does not hardcode the model name.

---

# 8. Why Provider and Model Are Separate

Consider the following configuration:

```env
AI_PROVIDER=gemini
AI_MODEL=gemini-3.5-flash-lite
```

The provider layer answers:

> "Which service should receive the request?"

The model configuration answers:

> "Which model should process the request?"

Keeping them separate makes model changes easier.

For example, if a different Gemini model is selected later, the application-level AI service does not need to change.

Only configuration needs to change.

---

# 9. `GEMINI_API_KEY`

```env
GEMINI_API_KEY=<secret>
```

This contains the credential used to authenticate requests to Gemini.

The key is passed to the Gemini SDK inside `GeminiProvider`:

```ts
this.client = new GoogleGenAI({
  apiKey: env.GEMINI_API_KEY,
});
```

The API key is therefore kept outside the source code.

## Security Rules

The API key must:

- never be hardcoded
- never be committed to Git
- never be logged
- never be returned in an API response
- never be sent to the frontend
- never be included in documentation

The repository should contain only a safe example such as:

```env
GEMINI_API_KEY=<your-api-key>
```

if an example environment file is provided.

---

# 10. `AI_MAX_INPUT_CHARS`

```env
AI_MAX_INPUT_CHARS=12000
```

This controls the maximum amount of content accepted by the AI Post Assistant.

The value is used directly by the request DTO:

```ts
content: z
  .string()
  .trim()
  .min(1, "Content is required")
  .max(
    env.AI_MAX_INPUT_CHARS,
    `Content cannot exceed ${env.AI_MAX_INPUT_CHARS} characters`,
  ),
```

This prevents unnecessarily large requests from reaching the AI provider.

### Why enforce an input limit?

Without an input limit, a client could send extremely large content to the AI endpoint.

That could cause:

- increased token usage
- increased latency
- higher provider consumption
- larger requests
- unnecessary load
- possible provider-side failures

Therefore, input validation happens before the provider is called.

---

# 11. `AI_MAX_OUTPUT_TOKENS`

```env
AI_MAX_OUTPUT_TOKENS=1000
```

This controls the maximum number of output tokens requested from the AI provider.

The value is passed through the abstraction layer:

```ts
maxOutputTokens:
  request.maxOutputTokens ?? env.AI_MAX_OUTPUT_TOKENS,
```

and eventually reaches Gemini:

```ts
config: {
  systemInstruction: request.systemInstruction,
  maxOutputTokens:
    request.maxOutputTokens ?? env.AI_MAX_OUTPUT_TOKENS,
  abortSignal: request.signal,
  ...
},
```

The important architectural point is that the feature does not directly configure the Gemini SDK.

Instead:

```text
AI Feature
    ↓
TextGenerationService
    ↓
AIProvider
    ↓
GeminiProvider
    ↓
Gemini SDK
```

The configuration flows through these layers.

---

# 12. `AI_TIMEOUT_MS`

Current local configuration:

```env
AI_TIMEOUT_MS=60000
```

The schema provides a default of:

```ts
.default(15000)
```

The configured value determines how long the application waits for an AI provider request before treating it as a timeout.

`TextGenerationService` creates an `AbortController`:

```ts
const controller = new AbortController();

const timeout = setTimeout(() => {
  controller.abort();
}, env.AI_TIMEOUT_MS);
```

The signal is then passed to the provider:

```ts
return await this.provider.generateText({
  ...request,
  signal: controller.signal,
});
```

The Gemini provider passes the signal to the Gemini SDK:

```ts
config: {
  ...
  abortSignal: request.signal,
}
```

This creates a timeout chain:

```text
AI_TIMEOUT_MS
      ↓
AbortController
      ↓
AbortSignal
      ↓
GeminiProvider
      ↓
Gemini SDK
```

If the controller is aborted, the service converts the situation into:

```ts
AITimeoutError;
```

which is returned to the application as a gateway-timeout style error.

---

# 13. Why Timeout Is Part of the Configuration

AI requests are external network operations.

Unlike a local function call, the application cannot assume that the provider will respond immediately.

Without a timeout, a request could potentially remain pending for too long.

A timeout therefore protects the API from waiting indefinitely for an external dependency.

The timeout is configurable because different environments may require different behavior.

---

# 14. `AI_MAX_RETRIES`

Current configuration:

```env
AI_MAX_RETRIES=2
```

This controls the maximum number of retry attempts for retryable provider failures.

The configuration is validated with:

```ts
AI_MAX_RETRIES: z
  .coerce
  .number()
  .int()
  .min(0)
  .max(5)
  .default(2),
```

The retry mechanism is implemented inside `TextGenerationService`.

The service retries selected transient failures such as:

```text
408
429
5xx
```

It does not blindly retry every error.

This is important because validation errors or other non-transient failures are unlikely to become successful simply by repeating the same request.

---

# 15. Why Limit the Retry Count?

Retries can improve reliability when an external provider experiences temporary failures.

However, unlimited retries would be dangerous.

They could cause:

- increased latency
- repeated provider requests
- increased API consumption
- request amplification during an outage

Therefore WriteSpace places an upper bound on retries.

The current configuration allows:

```text
0–5 retries
```

with the current environment using:

```text
2 retries
```

---

# 16. Configuration Validation

The AI configuration uses Zod rather than manually reading values from `process.env`.

For example, instead of application code repeatedly doing:

```ts
process.env.AI_TIMEOUT_MS;
```

the application uses the validated configuration:

```ts
env.AI_TIMEOUT_MS;
```

This provides a single configuration source for the application.

It also ensures that values such as:

```env
AI_TIMEOUT_MS=abc
```

are rejected instead of silently being used as invalid configuration.

---

# 17. Configuration Flow

The complete configuration flow is:

```text
.env
 │
 ▼
Environment Variables
 │
 ▼
src/config/env.ts
 │
 ▼
Zod Validation + Transformation
 │
 ▼
Validated `env`
 │
 ├───────────────┐
 │               │
 ▼               ▼
AI Provider      AI Services
 │               │
 ▼               ▼
Gemini SDK       AI Feature Logic
```

For example:

```text
AI_MODEL
   ↓
env.AI_MODEL
   ↓
GeminiProvider
   ↓
GoogleGenAI.generateContent()
   ↓
Gemini model
```

Similarly:

```text
AI_TIMEOUT_MS
   ↓
env.AI_TIMEOUT_MS
   ↓
TextGenerationService
   ↓
AbortController
   ↓
AbortSignal
   ↓
Provider request
```

---

# 18. Current Configuration Summary

| Configuration          | Current Value           | Purpose                         |
| ---------------------- | ----------------------- | ------------------------------- |
| `AI_ENABLED`           | `true`                  | Enables AI functionality        |
| `AI_PROVIDER`          | `gemini`                | Selects Gemini provider         |
| `AI_MODEL`             | `gemini-3.5-flash-lite` | Selects Gemini model            |
| `GEMINI_API_KEY`       | secret                  | Authenticates Gemini requests   |
| `AI_TIMEOUT_MS`        | `60000`                 | Maximum provider wait time      |
| `AI_MAX_INPUT_CHARS`   | `12000`                 | Limits AI input size            |
| `AI_MAX_OUTPUT_TOKENS` | `1000`                  | Limits generated output         |
| `AI_MAX_RETRIES`       | `2`                     | Maximum transient-error retries |

---

# 19. Configuration Responsibilities

The configuration system intentionally does not contain business logic.

For example:

```text
Configuration
    ↓
"What values should the system use?"
```

while:

```text
AI Service
    ↓
"What should the application do?"
```

and:

```text
AI Provider
    ↓
"How do we communicate with the external AI service?"
```

This separation keeps configuration, business logic, and infrastructure concerns independent.

---

# 20. What Configuration Does Not Handle

The configuration layer does not currently handle:

- AI usage tracking
- token/cost accounting
- per-user AI quotas
- database configuration for embeddings
- semantic-search configuration
- recommendation configuration
- user-interest configuration
- AI-specific persistent state

These are intentionally outside the current MVP.

If future AI features require them, they can be introduced when those features are actually implemented.

---

# 21. Current Security Considerations

The current configuration design provides the foundation for keeping AI credentials outside source code.

However, configuration alone does not make the complete AI API production-hardened.

The current implementation still needs additional operational protections before treating the AI endpoint as production-ready, particularly:

- dedicated AI endpoint rate limiting
- stronger abuse protection
- production secret-management strategy
- potentially per-user quotas
- monitoring of provider usage

These are separate reliability/security concerns and should not be confused with environment configuration.

---

# 22. Why We Did Not Create an AI Configuration Class

A separate class such as:

```ts
class AIConfig {
  ...
}
```

was not introduced.

The existing WriteSpace application already has a centralized configuration module:

```text
src/config/env.ts
```

Therefore the AI subsystem extends the existing configuration system instead of creating another configuration mechanism.

This avoids:

- duplicated environment parsing
- duplicated validation
- multiple sources of truth
- unnecessary abstraction

The AI configuration follows the architecture already established by WriteSpace.

---

# 23. Interview Explanation

If an interviewer asks:

> "How do you manage configuration for your AI integration?"

A concise answer would be:

> "I keep AI configuration in environment variables and validate it centrally using Zod in `src/config/env.ts`. The configuration includes the feature flag, provider, model, API key, input and output limits, timeout, and retry count. The API key never lives in source code. The validated configuration is consumed by the provider and service layers, so the AI feature itself doesn't depend directly on environment variables."

If asked:

> "Why did you make the model configurable?"

Answer:

> "I wanted to separate the provider from the model. The provider abstraction determines how we communicate with Gemini, while the model is configuration. That means I can change the model without changing the application-level AI service."

If asked:

> "Why do you have `AI_ENABLED`?"

Answer:

> "It's a kill switch. AI depends on an external provider, so if the provider is unavailable, expensive, or temporarily needs to be disabled, I can turn the feature off through configuration without changing application code."

If asked:

> "Why are timeout and retry configurable?"

Answer:

> "AI is an external network dependency. Timeout prevents requests from hanging indefinitely, while bounded retries improve resilience against transient failures. Making both configurable lets us tune behavior without changing the implementation."

---

# 24. Important Design Principles

The current AI configuration follows these principles:

### 1. Secrets outside source code

```text
API key → environment
```

not:

```text
API key → source code
```

### 2. Validate configuration early

```text
Environment
    ↓
Zod
    ↓
Validated configuration
```

### 3. Centralized configuration

All application configuration is accessed through:

```ts
env;
```

rather than reading `process.env` throughout the codebase.

### 4. Feature control

```text
AI_ENABLED
```

provides an operational kill switch.

### 5. Configurable external dependency

Provider, model, timeout, retries, and limits can change without rewriting the feature logic.

### 6. No premature configuration

Only configuration required by the current AI implementation has been introduced.

Future AI capabilities will add configuration only when those capabilities are implemented.

---

# 25. Current Status

The AI configuration layer is **implemented and actively used** by the current AI Post Assistant.

Currently configured:

```text
✓ AI feature flag
✓ Provider selection
✓ Model selection
✓ Gemini API credential
✓ Input size limit
✓ Output token limit
✓ Request timeout
✓ Retry limit
✓ Zod validation
✓ Mock provider selection
```

Not currently implemented:

```text
✗ Per-user AI quotas
✗ AI usage/cost tracking
✗ Dedicated AI rate limiter
✗ AI configuration database
✗ Semantic-search configuration
✗ Recommendation configuration
```

These should only be introduced when the corresponding requirements become real.

---

# 26. Related Documentation

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

The next document will explain the **Provider Layer**, including:

- `AIProvider` interface
- `GeminiProvider`
- `MockAIProvider`
- provider factory
- dependency injection
- why the feature does not directly depend on Gemini
- how a second provider could be added
- important code and interview-level design reasoning
