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

  if (onClose) {
    app.addHook("onClose", async () => {
      await onClose();
    });
  }

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
      const result = await captureService.capture(request.body.url);
      reply.header("Content-Type", "image/png");
      reply.header("X-Provider", result.provider);
      reply.header("X-Ad-Wait-Ms", String(result.adWaitMs));
      reply.send(result.image);
    }
  );

  app.setErrorHandler((error, request, reply) => {
    if (isValidationError(error)) {
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
        { code: error.code, details: error.details },
        error.message
      );
      return sendError(reply, error);
    }

    request.log.error({ err: error }, "Unhandled application error");
    return sendError(
      reply,
      createCaptureFailedError("Unhandled application error.")
    );
  });

  return app;
}
