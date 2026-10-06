import { AIService } from "../../../../src/modules/ai/services/ai.service";
import { AIResponseParseError } from "../../../../src/shared/ai/errors/ai.errors";

describe("AIService", () => {
  const createMockTextGenerationService = (responseText: string) => ({
    generate: jest.fn().mockResolvedValue({
      text: responseText,
    }),
  });

  const validRequest = {
    title: "Understanding Redis Caching",
    content:
      "Redis is an in-memory data store commonly used for caching frequently accessed data.",
    instruction: "Make the suggestions suitable for a technical blog.",
  };

  it("should generate valid post assistant suggestions", async () => {
    const mockTextGenerationService =
      createMockTextGenerationService(
        JSON.stringify({
          suggestedTitle: "Understanding Redis Caching",
          summary:
            "An introduction to using Redis as an in-memory caching solution.",
          topics: ["Redis", "Caching", "Backend"],
        }),
      );

    const aiService = new AIService(
      mockTextGenerationService as any,
    );

    const result = await aiService.generatePostAssistant(validRequest);

    expect(result).toEqual({
      suggestedTitle: "Understanding Redis Caching",
      summary:
        "An introduction to using Redis as an in-memory caching solution.",
      topics: ["Redis", "Caching", "Backend"],
    });

    expect(
      mockTextGenerationService.generate,
    ).toHaveBeenCalledTimes(1);
  });

  it("should throw AIResponseParseError when AI returns invalid JSON", async () => {
    const mockTextGenerationService =
      createMockTextGenerationService(
        "This is not valid JSON",
      );

    const aiService = new AIService(
      mockTextGenerationService as any,
    );

    await expect(
      aiService.generatePostAssistant(validRequest),
    ).rejects.toBeInstanceOf(AIResponseParseError);
  });

  it("should throw AIResponseParseError when AI returns invalid structured data", async () => {
    const mockTextGenerationService =
      createMockTextGenerationService(
        JSON.stringify({
          suggestedTitle: "Redis",
          summary: "Redis is useful.",
          // topics intentionally missing
        }),
      );

    const aiService = new AIService(
      mockTextGenerationService as any,
    );

    await expect(
      aiService.generatePostAssistant(validRequest),
    ).rejects.toBeInstanceOf(AIResponseParseError);
  });

  it("should propagate errors from TextGenerationService", async () => {
    const providerError = new Error(
      "AI provider request failed",
    );

    const mockTextGenerationService = {
      generate: jest.fn().mockRejectedValue(providerError),
    };

    const aiService = new AIService(
      mockTextGenerationService as any,
    );

    await expect(
      aiService.generatePostAssistant(validRequest),
    ).rejects.toBe(providerError);
  });
});