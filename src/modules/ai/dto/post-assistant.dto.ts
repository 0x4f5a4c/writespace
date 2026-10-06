import env from "@config/env";
import { z } from "zod";

export const postAssistantRequestSchema = z.object({
  title: z
    .string()
    .trim()
    .max(300, "Title cannot exceed 300 characters")
    .optional(),

  content: z
    .string()
    .trim()
    .min(1, "Content is required")
    .max(
      env.AI_MAX_INPUT_CHARS,
      `Content cannot exceed ${env.AI_MAX_INPUT_CHARS} characters`,
    ),

  instruction: z
    .string()
    .trim()
    .max(1000, "Instruction cannot exceed 1000 characters")
    .optional(),
});

export type PostAssistantRequest = z.infer<typeof postAssistantRequestSchema>;

export const postAssistantResponseSchema = z.object({
  suggestedTitle: z.string().min(1),
  summary: z.string().min(1),
  topics: z.array(z.string()).min(1),
});

export type PostAssistantResponse = z.infer<typeof postAssistantResponseSchema>;
