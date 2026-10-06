import { TextGenerationService } from "../../../src/shared/ai/services/text-generation.service";
import type {
  AIProvider,
  AITextGenerationRequest,
  AITextGenerationResponse,
} from "../../../src/shared/ai/providers/ai.provider";

import {
  AIDisabledError,
  AIProviderError,
  AITimeoutError,
} from "../../../src/shared/ai/errors/ai.errors";

import env from "../../../src/config/env";

class TestAIProvider implements AIProvider {
  constructor(
    private readonly response: AITextGenerationResponse = {
      text: "Mock AI response",
    },
  ) {}

  async generateText(
    _request: AITextGenerationRequest,
  ): Promise<AITextGenerationResponse> {
    return this.response;
  }
}

class FailingAIProvider implements AIProvider {
  async generateText(
    _request: AITextGenerationRequest,
  ): Promise<AITextGenerationResponse> {
    throw new Error("Provider failed");
  }
}

class TimeoutAIProvider implements AIProvider {
  async generateText(
    _request: AITextGenerationRequest,
  ): Promise<AITextGenerationResponse> {
    return new Promise(() => {});
  }
}

describe("TextGenerationService", () => {
  const request: AITextGenerationRequest = {
    prompt: "Generate a short summary about JavaScript.",
  };

  const originalAIEnabled = env.AI_ENABLED;

  afterEach(() => {
    env.AI_ENABLED = originalAIEnabled;
  });

  it("should generate text successfully using the provided provider", async () => {
    env.AI_ENABLED = true;
    const provider = new TestAIProvider({
      text: "JavaScript is a programming language.",
    });

    const service = new TextGenerationService(provider);

    const response = await service.generate(request);

    expect(response).toEqual({
      text: "JavaScript is a programming language.",
    });
  });

  it("should throw AIDisabledError when AI is disabled", async () => {
    env.AI_ENABLED = false;

    const service = new TextGenerationService(new TestAIProvider());

    await expect(service.generate(request)).rejects.toBeInstanceOf(
      AIDisabledError,
    );
  });

  it("should convert unexpected provider errors into AIProviderError", async () => {
    env.AI_ENABLED = true;
    const service = new TextGenerationService(new FailingAIProvider());

    await expect(service.generate(request)).rejects.toBeInstanceOf(
      AIProviderError,
    );
  });

  it("should throw AITimeoutError when provider exceeds timeout", async () => {
    env.AI_ENABLED = true;

    const originalTimeout = env.AI_TIMEOUT_MS;
    env.AI_TIMEOUT_MS = 50;

    const provider: AIProvider = {
      generateText: jest.fn(
        ({ signal }: AITextGenerationRequest) =>
          new Promise<AITextGenerationResponse>((_, reject) => {
            signal?.addEventListener("abort", () => {
              reject(new Error("Request aborted"));
            });
          }),
      ),
    };

    const service = new TextGenerationService(provider);

    await expect(
      service.generate({
        prompt: "Test prompt",
      }),
    ).rejects.toBeInstanceOf(AITimeoutError);

    env.AI_TIMEOUT_MS = originalTimeout;
  });

  it("should retry when the provider returns a transient 503 error", async () => {
    const provider = {
      generateText: jest
        .fn()
        .mockRejectedValueOnce({
          status: 503,
          message: "Service unavailable",
        })
        .mockRejectedValueOnce({
          status: 503,
          message: "Service unavailable",
        })
        .mockResolvedValueOnce({
          text: "Success after retry",
        }),
    };

    const service = new TextGenerationService(provider);

    const result = await service.generate({
      prompt: "Test prompt",
    });

    expect(result).toEqual({
      text: "Success after retry",
    });

    expect(provider.generateText).toHaveBeenCalledTimes(3);
  });

  it("should not retry non-transient provider errors", async () => {
    const providerError = {
      status: 400,
      message: "Invalid request",
    };

    const provider = {
      generateText: jest.fn().mockRejectedValue(providerError),
    };

    const service = new TextGenerationService(provider);

    await expect(
      service.generate({
        prompt: "Test prompt",
      }),
    ).rejects.toThrow("AI provider request failed");

    expect(provider.generateText).toHaveBeenCalledTimes(1);
  });
});
