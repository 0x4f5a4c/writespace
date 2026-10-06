import logger from "@config/logger";

import {
  postAssistantResponseSchema,
  type PostAssistantRequest,
  type PostAssistantResponse,
} from "../dto/post-assistant.dto";

import { TextGenerationService } from "@shared/ai/services/text-generation.service";
import { AIResponseParseError } from "@shared/ai/errors/ai.errors";

export class AIService {
  constructor(private readonly textGenerationService: TextGenerationService) {}

  public async generatePostAssistant(
    request: PostAssistantRequest,
  ): Promise<PostAssistantResponse> {
    const prompt = this.buildPostAssistantPrompt(request);

    const response = await this.textGenerationService.generate({
      prompt,
      systemInstruction:
        "You are an AI writing assistant for a technical blogging platform. Return only valid JSON matching the requested structure.",
    });

    const parsedResponse = this.parseAIResponse(response.text);

    const validatedResponse =
      postAssistantResponseSchema.safeParse(parsedResponse);

    if (!validatedResponse.success) {
      logger.error(
        `[AI] Post assistant returned invalid structured data: ${validatedResponse.error.message}`,
      );

      throw new AIResponseParseError();
    }

    return validatedResponse.data;
  }

  private buildPostAssistantPrompt(request: PostAssistantRequest): string {
    return `
Generate suggestions for the following technical blog post.

Post title:
${request.title ?? "No title provided"}

Post content:
${request.content}

Additional instruction:
${request.instruction ?? "None"}

Return ONLY valid JSON in exactly this structure:

{
  "suggestedTitle": "string",
  "summary": "string",
  "topics": ["string"]
}

Requirements:
- suggestedTitle should be concise and relevant to the post.
- summary should accurately summarize the provided content.
- topics should contain relevant technical topics.
- Do not include markdown.
- Do not include code fences.
- Do not include any text outside the JSON object.
`;
  }

  private parseAIResponse(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      logger.error("[AI] Post assistant returned invalid JSON");

      throw new AIResponseParseError();
    }
  }
}
