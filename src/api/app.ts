import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";

import {
  AppError,
  createCaptureFailedError,
  toErrorPayload
} from "../errors";
import type { AppLogger } from "../logger";
import type { ScreenshotRequestBody } from "../types";
import type { CaptureService } from "../capture/capture-service";

interface CreateAppOptions {
  captureService: CaptureService;
  logger: AppLogger;
  onClose?: () => Promise<void>;
}

function isValidationError(
  error: unknown
): error is Error & { validation: unknown[] } {
  return (
    error instanceof Error &&
    "validation" in error &&
    Array.isArray(error.validation)
  );
}

function sendError(reply: FastifyReply, error: AppError): void {
  reply.status(error.statusCode).send(toErrorPayload(error));
}

export function createApp({
  captureService,
  logger,
  onClose
}: CreateAppOptions) {
  const app = Fastify({ loggerInstance: logger });
  const requestStartedAt = new Map<string, number>();

  if (onClose) {
    app.addHook("onClose", async () => {
      await onClose();
    });
  }

  app.addHook("onRequest", async (request) => {
    const startedAt = Date.now();
    requestStartedAt.set(request.id, startedAt);
    request.log.info(
      {
        step: "http:request_started",
        method: request.method,
        url: request.url,
        remoteAddress: request.ip
      },
      "HTTP request started"
    );
    request.raw.on("aborted", () => {
      request.log.warn(
        {
          step: "http:request_aborted",
          method: request.method,
          url: request.url,
          elapsedMs: Date.now() - startedAt
        },
        "HTTP request aborted by client"
      );
      requestStartedAt.delete(request.id);
    });
  });

  app.addHook("onResponse", async (request, reply) => {
    const startedAt = requestStartedAt.get(request.id);
    requestStartedAt.delete(request.id);
    request.log.info(
      {
        step: "http:request_completed",
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        elapsedMs: startedAt ? Date.now() - startedAt : undefined
      },
      "HTTP request completed"
    );
  });

  app.get("/health", async () => {
    return { status: "ok" };
  });

  app.post<{ Body: ScreenshotRequestBody }>(
    "/api/screenshot",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["url"],
          properties: {
            url: { type: "string", minLength: 1 }
          }
        }
      }
    },
    async (
      request: FastifyRequest<{ Body: ScreenshotRequestBody }>,
      reply: FastifyReply
    ) => {
      const requestLogger = request.log.child({
        route: "/api/screenshot",
        targetUrl: request.body.url
      });
      requestLogger.info(
        { step: "http:capture_started" },
        "Starting screenshot capture request"
      );
      const result = await captureService.capture(request.body.url, requestLogger);
      requestLogger.info(
        {
          step: "http:capture_succeeded",
          provider: result.provider,
          adWaitMs: result.adWaitMs,
          imageBytes: result.image.length
        },
        "Screenshot capture request succeeded"
      );
      reply.header("Content-Type", "image/png");
      reply.header("X-Provider", result.provider);
      reply.header("X-Ad-Wait-Ms", String(result.adWaitMs));
      reply.send(result.image);
    }
  );

  app.setErrorHandler((error, request, reply) => {
    const startedAt = requestStartedAt.get(request.id);
    const elapsedMs = startedAt ? Date.now() - startedAt : undefined;

    if (isValidationError(error)) {
      request.log.warn(
        {
          step: "http:request_invalid",
          method: request.method,
          url: request.url,
          elapsedMs
        },
        "HTTP request body validation failed"
      );
      return sendError(
        reply,
        new AppError(
          400,
          "invalid_request",
          "Request body must be a JSON object containing a non-empty url string."
        )
      );
    }

    if (error instanceof AppError) {
      request.log.warn(
        {
          step: "http:request_failed",
          code: error.code,
          details: error.details,
          elapsedMs
        },
        error.message
      );
      return sendError(reply, error);
    }

    request.log.error(
      {
        step: "http:request_failed",
        err: error,
        elapsedMs
      },
      "Unhandled application error"
    );
    return sendError(
      reply,
      createCaptureFailedError("Unhandled application error.")
    );
  });

  return app;
}
