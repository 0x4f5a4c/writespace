import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import env from "@config/env";
import logger from "@config/logger";

import type {
  AIProvider,
  AITextGenerationRequest,
  AITextGenerationResponse,
} from "./ai.provider";

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
        thinkingConfig: {
          thinkingLevel: ThinkingLevel.LOW,
        },
        abortSignal: request.signal,
      },
    });

    logger.debug(`[AI] Gemini response received`);

    return {
      text: response.text ?? "",
    };
  }
}
