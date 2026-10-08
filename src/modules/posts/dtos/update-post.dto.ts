import { z } from "zod";

export const updatePostSchema = z.object({
  body: z.object({
    title: z
      .string()
      .trim()
      .min(3, "Title must be at least 3 characters")
      .max(200, "Title cannot exceed 200 characters")
      .optional(),

    content: z.string().optional(),

    subtitle: z
      .string()
      .trim()
      .max(300, "Subtitle cannot exceed 300 characters")
      .optional()
      .nullable(),

    excerpt: z
      .string()
      .trim()
      .max(300, "Excerpt cannot exceed 300 characters")
      .optional()
      .nullable(),

    tags: z
      .array(z.string().trim().min(1, "Tag cannot be empty"))
      .max(5, "Maximum 5 tags allowed")
      .optional(),

    codeSnippets: z
      .array(
        z.object({
          language: z.string().trim().min(1, "Language is required"),
          code: z.string(),
        }),
      )
      .optional()
      .nullable(),

    existingMedia: z
      .union([z.string().url(), z.array(z.string().url())])
      .optional(),

    existingMediaPublicIds: z
      .union([z.string().min(1), z.array(z.string().min(1))])
      .optional(),

    status: z
      .enum(["draft", "scheduled", "published", "archived", "trash"])
      .optional(),

    scheduledAt: z.string().datetime({ offset: true }).optional().nullable(),

    coverImageAltText: z
      .string()
      .trim()
      .max(300, "Alt text cannot exceed 300 characters")
      .optional()
      .nullable(),

    coverImageCredit: z
      .string()
      .trim()
      .max(300, "Credit cannot exceed 300 characters")
      .optional()
      .nullable(),
  }),
});

export type UpdatePostDto = z.infer<typeof updatePostSchema>["body"];
