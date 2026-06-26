import type { ProviderName } from "./types";

export type ErrorCode =
  | "invalid_request"
  | "unsupported_url"
  | "unsupported_content"
  | "ad_timeout"
  | "fullscreen_failed"
  | "capture_failed";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: Record<string, unknown>;

  constructor(
    statusCode: number,
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function createUnsupportedUrlError(url: string, reason: string): AppError {
  return new AppError(422, "unsupported_url", reason, { url });
}

export function createUnsupportedContentError(
  provider: ProviderName,
  reason: string
): AppError {
  return new AppError(422, "unsupported_content", reason, { provider });
}

export function createAdTimeoutError(
  provider: ProviderName,
  waitedMs: number
): AppError {
  return new AppError(
    504,
    "ad_timeout",
    `Timed out while waiting for ${provider} advertisement to finish.`,
    { provider, waitedMs }
  );
}

export function createFullscreenError(provider: ProviderName): AppError {
  return new AppError(
    500,
    "fullscreen_failed",
    `Unable to enter fullscreen mode for ${provider}.`,
    { provider }
  );
}

export function createCaptureFailedError(
  message: string,
  details?: Record<string, unknown>
): AppError {
  return new AppError(500, "capture_failed", message, details);
}

export function toErrorPayload(error: AppError): Record<string, unknown> {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {})
    }
  };
}
