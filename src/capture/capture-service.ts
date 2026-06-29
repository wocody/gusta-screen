import type { BrowserContext } from "playwright";

import type { BrowserManager } from "../browser/browser-manager";
import type { AppConfig } from "../config";
import { Deadline } from "./deadline";
import { Semaphore } from "../concurrency/semaphore";
import {
  AppError,
  createCaptureFailedError,
  isAppError
} from "../errors";
import type { AppLogger } from "../logger";
import type { CaptureResult } from "../types";
import { createProvider } from "../providers";
import { resolveTargetUrl, type ResolvedTarget } from "../url/resolve-target";
import {
  RapidApiYouTubeClient,
  type ExternalImageAsset,
  type YouTubeImageClient
} from "../youtube/rapidapi-client";

export interface CaptureService {
  capture(url: string): Promise<CaptureResult>;
}

export interface CaptureServiceHooks {
  onContextCreated?: (
    context: BrowserContext,
    target: ResolvedTarget
  ) => Promise<void>;
}

export interface CaptureServiceDependencies {
  youtubeClient?: YouTubeImageClient;
}

export class PlaywrightCaptureService implements CaptureService {
  private readonly semaphore: Semaphore;
  private readonly youtubeClient: YouTubeImageClient;

  constructor(
    private readonly browserManager: BrowserManager,
    private readonly config: AppConfig,
    private readonly logger: AppLogger,
    private readonly hooks: CaptureServiceHooks = {},
    dependencies: CaptureServiceDependencies = {}
  ) {
    this.semaphore = new Semaphore(config.maxConcurrentCaptures);
    this.youtubeClient =
      dependencies.youtubeClient ?? new RapidApiYouTubeClient(config);
  }

  async capture(url: string): Promise<CaptureResult> {
    const target = resolveTargetUrl(url, this.config);

    return await this.semaphore.runExclusive(async () => {
      const deadline = new Deadline(this.config.captureTimeoutMs);
      const requestLogger = this.logger.child({
        provider: target.provider,
        url: target.normalizedUrl
      });

      try {
        if (target.provider === "youtube") {
          return await this.captureYouTube(target, deadline, requestLogger);
        }

        return await this.captureTwitch(target, deadline, requestLogger);
      } catch (error) {
        throw this.mapError(error);
      }
    });
  }

  private async captureYouTube(
    target: ResolvedTarget,
    deadline: Deadline,
    requestLogger: AppLogger
  ): Promise<CaptureResult> {
    const imageAsset = await this.youtubeClient.fetchImage(
      target,
      deadline,
      requestLogger
    );
    const image = await this.renderExternalImage(target, deadline, imageAsset);

    return {
      provider: target.provider,
      adWaitMs: 0,
      image
    };
  }

  private async captureTwitch(
    target: ResolvedTarget,
    deadline: Deadline,
    requestLogger: AppLogger
  ): Promise<CaptureResult> {
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
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  private async renderExternalImage(
    target: ResolvedTarget,
    deadline: Deadline,
    imageAsset: ExternalImageAsset
  ): Promise<Buffer> {
    const context = await this.browserManager.newContext();
    await this.hooks.onContextCreated?.(context, target);
    const page = await context.newPage();
    const safeContentType = imageAsset.contentType.replace(/"/g, "");
    const dataUrl = `data:${safeContentType};base64,${imageAsset.bytes.toString("base64")}`;

    page.setDefaultNavigationTimeout(this.config.captureTimeoutMs);
    page.setDefaultTimeout(Math.min(this.config.captureTimeoutMs, 15_000));

    try {
      await page.setContent(
        [
          "<!doctype html>",
          "<html>",
          "<head>",
          '<meta charset="utf-8" />',
          "<style>",
          "html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #000; }",
          "#capture { width: 100vw; height: 100vh; object-fit: cover; display: block; }",
          "</style>",
          "</head>",
          "<body>",
          `<img id="capture" alt="YouTube capture" src="${dataUrl}" />`,
          "</body>",
          "</html>"
        ].join(""),
        {
          waitUntil: "domcontentloaded",
          timeout: deadline.slice(this.config.captureTimeoutMs)
        }
      );

      await page.waitForFunction(
        () => {
          const image = document.getElementById("capture");
          return (
            image instanceof HTMLImageElement &&
            image.complete &&
            image.naturalWidth > 0 &&
            image.naturalHeight > 0
          );
        },
        { timeout: deadline.slice(10_000) }
      );

      return await page.screenshot({ type: "png" });
    } finally {
      await context.close().catch(() => undefined);
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
