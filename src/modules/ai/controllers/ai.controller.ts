import type { Request, Response } from "express";

import { HTTP_STATUS } from "@shared/constants/http-codes";
import { postAssistantRequestSchema } from "../dto/post-assistant.dto";
import { AIService } from "../services/ai.service";
import { textGenerationService } from "@shared/ai/services/text-generation.service";

export class AIController {
  constructor(private readonly aiService: AIService) {}

  public async generatePostAssistant(
    req: Request,
    res: Response,
  ): Promise<void> {
    const validatedRequest = postAssistantRequestSchema.safeParse(req.body);

    if (!validatedRequest.success) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        status: "fail",
        message: "Invalid post assistant request",
        errors: validatedRequest.error.flatten(),
      });

      return;
    }

    const result = await this.aiService.generatePostAssistant(
      validatedRequest.data,
    );

    res.status(HTTP_STATUS.OK).json({
      status: "success",
      data: result,
    });
  }
}

const aiService = new AIService(textGenerationService);
export const aiController = new AIController(aiService);
