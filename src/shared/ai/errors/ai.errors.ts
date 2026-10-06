import { HTTP_STATUS } from "@shared/constants/http-codes";
import { AppError } from "@shared/utils/app.error";

export class AIDisabledError extends AppError {
  constructor() {
    super(
      HTTP_STATUS.SERVICE_UNAVAILABLE,
      "AI features are currently disabled",
    );
  }
}

export class AIProviderError extends AppError {
  constructor(message = "AI provider request failed") {
    super(HTTP_STATUS.BAD_GATEWAY, message);
  }
}

export class AITimeoutError extends AppError {
  constructor() {
    super(HTTP_STATUS.GATEWAY_TIMEOUT, "AI provider request timed out");
  }
}

export class AIValidationError extends AppError {
  constructor(message: string) {
    super(HTTP_STATUS.BAD_REQUEST, message);
  }
}

export class AIResponseParseError extends AppError {
  constructor() {
    super(HTTP_STATUS.BAD_GATEWAY, "AI provider returned an invalid response");
  }
}
