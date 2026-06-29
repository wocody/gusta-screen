import type { BrowserContext } from "playwright";

import type { BrowserManager } from "../browser/browser-manager";
import type { AppConfig } from "../config";
import {
  AppError,
  createCaptureFailedError,
  createTooManyRequestsError,
  isAppError
} from "../errors";
import type { AppLogger } from "../logger";
import { createProvider } from "../providers";
import type { CaptureResult } from "../types";
import { resolveTargetUrl, type ResolvedTarget } from "../url/resolve-target";
import { Semaphore } from "../concurrency/semaphore";
import { Deadline } from "./deadline";

export interface CaptureService {
  capture(url: string, logger?: AppLogger): Promise<CaptureResult>;
}

export interface CaptureServiceHooks {
  onContextCreated?: (
    context: BrowserContext,
    target: ResolvedTarget
  ) => Promise<void>;
}

export class PlaywrightCaptureService implements CaptureService {
  private readonly semaphore: Semaphore;

  constructor(
    private readonly browserManager: BrowserManager,
    private readonly config: AppConfig,
    private readonly logger: AppLogger,
    private readonly hooks: CaptureServiceHooks = {}
  ) {
    this.semaphore = new Semaphore(config.maxConcurrentCaptures);
  }

  async capture(url: string, logger: AppLogger = this.logger): Promise<CaptureResult> {
    const captureStartedAt = Date.now();
    logger.info({ step: "capture:resolve_target", rawUrl: url }, "Resolving target URL");
    const target = resolveTargetUrl(url, this.config);
    const baseLogger = logger.child({
      provider: target.provider,
      url: target.normalizedUrl
    });

    baseLogger.info(
      {
        step: "capture:slot_check",
        activeCount: this.semaphore.currentCount,
        maxConcurrentCaptures: this.config.maxConcurrentCaptures
      },
      "Checking capture slot availability"
    );
    const release = this.semaphore.tryAcquire();

    if (!release) {
      baseLogger.warn(
        {
          step: "capture:slot_rejected",
          activeCount: this.semaphore.currentCount,
          maxConcurrentCaptures: this.config.maxConcurrentCaptures
        },
        "Capture request rejected because the service is at capacity"
      );
      throw createTooManyRequestsError(
        this.semaphore.currentCount,
        this.config.maxConcurrentCaptures
      );
    }

    const queueWaitMs = 0;

    baseLogger.info(
      {
        step: "capture:slot_acquired",
        queueWaitMs,
        activeCount: this.semaphore.currentCount,
        maxConcurrentCaptures: this.config.maxConcurrentCaptures
      },
      "Capture slot acquired"
    );

    try {
      const deadline = new Deadline(this.config.captureTimeoutMs);
      const requestLogger = baseLogger.child({
        queueWaitMs,
        timeoutMs: this.config.captureTimeoutMs
      });

      requestLogger.info(
        {
          step: "capture:context_create",
          remainingMs: deadline.remainingMs()
        },
        "Creating Playwright browser context"
      );
      const context = await this.browserManager.newContext(requestLogger);
      requestLogger.info(
        {
          step: "capture:context_ready",
          remainingMs: deadline.remainingMs()
        },
        "Playwright browser context created"
      );
      await this.hooks.onContextCreated?.(context, target);
      requestLogger.info(
        {
          step: "capture:page_create",
          remainingMs: deadline.remainingMs()
        },
        "Opening Playwright page"
      );
      const page = await context.newPage();
      requestLogger.info(
        {
          step: "capture:page_ready",
          remainingMs: deadline.remainingMs()
        },
        "Playwright page opened"
      );

      page.setDefaultNavigationTimeout(this.config.captureTimeoutMs);
      page.setDefaultTimeout(Math.min(this.config.captureTimeoutMs, 15_000));

      try {
        requestLogger.info({ step: "navigate" }, "Navigating to target page");
        await page.goto(target.normalizedUrl, {
          waitUntil: "domcontentloaded",
          timeout: deadline.slice(this.config.captureTimeoutMs)
        });
        await page
          .waitForLoadState("load", { timeout: deadline.slice(5_000) })
          .catch(() => undefined);
        requestLogger.info(
          {
            step: "capture:navigation_complete",
            remainingMs: deadline.remainingMs()
          },
          "Target page loaded"
        );

        const provider = createProvider(target.provider);
        requestLogger.info(
          {
            step: "capture:provider_prepare",
            provider: provider.name,
            remainingMs: deadline.remainingMs()
          },
          "Preparing provider for screenshot"
        );
        const { adWaitMs } = await provider.prepareForScreenshot({
          page,
          deadline,
          logger: requestLogger
        });
        requestLogger.info(
          {
            step: "capture:provider_ready",
            adWaitMs,
            remainingMs: deadline.remainingMs()
          },
          "Provider preparation completed"
        );

        requestLogger.info(
          { step: "screenshot", adWaitMs },
          "Capturing PNG screenshot"
        );
        const image = await page.screenshot({ type: "png" });
        requestLogger.info(
          {
            step: "capture:complete",
            adWaitMs,
            imageBytes: image.length,
            elapsedMs: Date.now() - captureStartedAt,
            remainingMs: deadline.remainingMs()
          },
          "Capture completed successfully"
        );

        return {
          provider: target.provider,
          adWaitMs,
          image
        };
      } catch (error) {
        requestLogger.error(
          {
            step: "capture:failed",
            elapsedMs: Date.now() - captureStartedAt,
            remainingMs: deadline.remainingMs(),
            err: error
          },
          "Capture failed"
        );
        throw this.mapError(error);
      } finally {
        requestLogger.info({ step: "capture:context_close" }, "Closing Playwright context");
        await context.close().catch(() => undefined);
      }
    } finally {
      release();
    }
  }

  private mapError(error: unknown): AppError {
    if (isAppError(error)) {
      return error;
    }

    if (error instanceof Error) {
      return createCaptureFailedError(error.message);
    }

    return createCaptureFailedError("Unexpected screenshot capture failure.");
  }
}
