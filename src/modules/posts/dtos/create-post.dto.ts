import { z } from "zod";

export const CreatePostSchema = z.object({
  body: z.object({
    title: z
      .string()
      .trim()
      .min(5, "Title must be at least 5 characters long")
      .max(200, "Title must not exceed 200 characters"),

    subtitle: z
      .string()
      .trim()
      .max(300, "Subtitle must not exceed 300 characters")
      .optional(),

    content: z.string().default(""),

    tags: z
      .array(z.string().trim().min(1, "Tag cannot be empty"))
      .max(5, "Maximum 5 tags allowed")
      .default([]),

    codeSnippets: z
      .array(
        z.object({
          language: z.string().trim().min(1, "Language is required"),
          code: z.string(),
        }),
      )
      .default([]),

    status: z.enum(["draft", "scheduled", "published"]).default("draft"),

    scheduledAt: z.string().datetime({ offset: true }).optional(),
  }),
});

export type CreatePostInput = z.infer<typeof CreatePostSchema>["body"];
