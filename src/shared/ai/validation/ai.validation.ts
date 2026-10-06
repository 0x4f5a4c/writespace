import env from "@config/env";
import { AIValidationError } from "../errors/ai.errors";

export function validateAIInputLength(
  value: string,
  fieldName = "input",
): void {
  if (value.length > env.AI_MAX_INPUT_CHARS) {
    throw new AIValidationError(
      `${fieldName} exceeds the maximum allowed length of ${env.AI_MAX_INPUT_CHARS} characters`,
    );
  }
}
