export interface AIProvider {
  generateText(
    request: AITextGenerationRequest,
  ): Promise<AITextGenerationResponse>;
}

export interface AITextGenerationRequest {
  prompt: string;
  systemInstruction?: string;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export interface AITextGenerationResponse {
  text: string;
}
