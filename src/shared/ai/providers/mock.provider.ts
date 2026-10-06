import {
  AIProvider,
  AITextGenerationRequest,
  AITextGenerationResponse,
} from "./ai.provider";

export class MockAIProvider implements AIProvider {
  async generateText(
    _request: AITextGenerationRequest,
  ): Promise<AITextGenerationResponse> {
    return {
      text: "This is a mock AI Response",
    };
  }
}
