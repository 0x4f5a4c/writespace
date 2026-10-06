import logger from "@config/logger";
import env from "@config/env";

import { createAIProvider } from "../providers/ai-provider.factory";

import type {
  AIProvider,
  AITextGenerationRequest,
  AITextGenerationResponse,
} from "../providers/ai.provider";

import {
  AIDisabledError,
  AIProviderError,
  AITimeoutError,
} from "../errors/ai.errors";

export class TextGenerationService {
  private readonly provider: AIProvider;

  constructor(provider: AIProvider = createAIProvider()) {
    this.provider = provider;
  }

  public async generate(
    request: AITextGenerationRequest,
  ): Promise<AITextGenerationResponse> {
    if (!env.AI_ENABLED) {
      throw new AIDisabledError();
    }

    const startTime = Date.now();

    try {
      logger.debug(
        `[AI] Text generation started using provider: ${env.AI_PROVIDER}`,
      );

      const response = await this.generateWithRetry(request);

      const duration = Date.now() - startTime;

      logger.info(`[AI] Text generation completed in ${duration}ms`);

      return response;
    } catch (error) {
      const duration = Date.now() - startTime;

      if (error instanceof AITimeoutError) {
        logger.error(`[AI] Text generation timed out after ${duration}ms`);

        throw error;
      }

      if (error instanceof AIProviderError) {
        logger.error(
          `[AI] Provider error after ${duration}ms: ${error.message}`,
        );

        throw error;
      }

      logger.error(`[AI] Text generation failed after ${duration}ms: ${error}`);

      throw new AIProviderError();
    }
  }

  private async generateWithRetry(
    request: AITextGenerationRequest,
  ): Promise<AITextGenerationResponse> {
    let attempt = 0;

    while (true) {
      try {
        return await this.generateWithTimeout(request);
      } catch (error) {
        // Timeout means the request was already aborted.
        // Do NOT retry it.
        if (error instanceof AITimeoutError) {
          throw error;
        }

        if (!this.isRetryableError(error)) {
          throw error;
        }

        if (attempt >= env.AI_MAX_RETRIES) {
          throw error;
        }

        attempt++;

        const delay = this.calculateBackoffDelay(attempt);

        logger.warn(
          `[AI] Transient provider error. Retrying attempt ${attempt}/${env.AI_MAX_RETRIES} after ${delay}ms`,
        );

        await this.sleep(delay);
      }
    }
  }

  private async generateWithTimeout(
    request: AITextGenerationRequest,
  ): Promise<AITextGenerationResponse> {
    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, env.AI_TIMEOUT_MS);

    try {
      return await this.provider.generateText({
        ...request,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new AITimeoutError();
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private isRetryableError(error: unknown): boolean {
    if (!error || typeof error !== "object") {
      return false;
    }

    const providerError = error as {
      status?: number | string;
      statusCode?: number | string;
    };

    const status = Number(providerError.status ?? providerError.statusCode);

    if ([408, 429].includes(status)) {
      return true;
    }

    if (status >= 500 && status <= 599) {
      return true;
    }

    return false;
  }

  private calculateBackoffDelay(attempt: number): number {
    return 1000 * 2 ** (attempt - 1);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}

export const textGenerationService = new TextGenerationService();
