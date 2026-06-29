import type { BrowserContext } from "playwright";

import type { BrowserManager } from "../browser/browser-manager";
import type { AppConfig } from "../config";
import {
  AppError,
  createCaptureFailedError,
  isAppError
} from "../errors";
import type { AppLogger } from "../logger";
import { createProvider } from "../providers";
import type { CaptureResult } from "../types";
import { resolveTargetUrl, type ResolvedTarget } from "../url/resolve-target";
import { Semaphore } from "../concurrency/semaphore";
import { Deadline } from "./deadline";

export interface CaptureService {
  capture(url: string): Promise<CaptureResult>;
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

  async capture(url: string): Promise<CaptureResult> {
    const target = resolveTargetUrl(url, this.config);

    return await this.semaphore.runExclusive(async () => {
      const deadline = new Deadline(this.config.captureTimeoutMs);
      const requestLogger = this.logger.child({
        provider: target.provider,
        url: target.normalizedUrl
      });
      const context = await this.browserManager.newContext();
      await this.hooks.onContextCreated?.(context, target);
      const page = await context.newPage();

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

        const provider = createProvider(target.provider);
        const { adWaitMs } = await provider.prepareForScreenshot({
          page,
          deadline,
          logger: requestLogger
        });

        requestLogger.info(
          { step: "screenshot", adWaitMs },
          "Capturing PNG screenshot"
        );
        const image = await page.screenshot({ type: "png" });

        return {
          provider: target.provider,
          adWaitMs,
          image
        };
      } catch (error) {
        throw this.mapError(error);
      } finally {
        await context.close().catch(() => undefined);
      }
    });
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
