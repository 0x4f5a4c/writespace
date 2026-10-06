import env from "@config/env";
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
      throw new Error(`Unsupported AI Provider: ${env.AI_PROVIDER}`);
  }
}
