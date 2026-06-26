import type { Page } from "playwright";

import {
  createAdTimeoutError,
  createCaptureFailedError,
  createFullscreenError,
  createUnsupportedContentError
} from "../errors";
import { type ProviderHandler, type ProviderRuntime } from "./base";
import {
  bodyTextIncludes,
  clickFirstVisible,
  delay,
  hasVisibleSelector,
  hideCursor,
  revealPlayerControls,
  waitForFullscreen
} from "./provider-helpers";

const CONSENT_SELECTORS = [
  'button:has-text("Accept")',
  'button:has-text("Accept all")'
];
const SIMPLE_GATE_SELECTORS = [
  'button:has-text("Start Watching")',
  'button:has-text("Mature audiences")',
  'button:has-text("Continue")',
  '[data-a-target="content-classification-gate-overlay-start-watching-button"]'
];
const PLAY_SELECTORS = [
  '[data-a-target="player-overlay-play-button"]',
  '[data-a-target="player-play-pause-button"]',
  'button[aria-label="Play"]'
];
const FULLSCREEN_SELECTORS = [
  '[data-a-target="player-fullscreen-button"]',
  'button[aria-label*="Fullscreen" i]'
];
const AD_SELECTORS = [
  '[data-test-selector="ad-banner-default-text"]',
  '[data-test-selector="ad-countdown"]',
  '[data-a-target="video-ad-label"]',
  ".player-ad-notice"
];
const UNSUPPORTED_TEXT = [
  "subscribe to watch",
  "this channel is unavailable",
  "content not available",
  "log in to watch this content"
];
const UNSUPPORTED_SELECTORS = [
  '[data-test-selector="content-overlay-gate"]'
];

export class TwitchProvider implements ProviderHandler {
  readonly name = "twitch" as const;

  async prepareForScreenshot({
    page,
    deadline,
    logger
  }: ProviderRuntime): Promise<{ adWaitMs: number }> {
    logger.info({ step: "twitch:consent" }, "Resolving Twitch consent gates");
    await this.dismissConsent(page, deadline);
    await this.dismissSimpleGate(page, deadline);
    await this.ensureSupportedContent(page);
    await this.waitForVideo(page, deadline);
    await this.ensurePlayback(page, deadline, logger);
    await this.enterFullscreen(page, deadline);
    const adWaitMs = await this.waitForAdsToClear(page, deadline);
    await hideCursor(page);
    await delay(page, 1_500);
    return { adWaitMs };
  }

  private async dismissConsent(page: Page, deadline: { slice: (ms: number) => number }): Promise<void> {
    const selector = await clickFirstVisible(page, CONSENT_SELECTORS, {
      force: true
    });
    if (selector) {
      await page.waitForTimeout(Math.min(500, deadline.slice(500)));
    }
  }

  private async dismissSimpleGate(page: Page, deadline: { slice: (ms: number) => number }): Promise<void> {
    const selector = await clickFirstVisible(page, SIMPLE_GATE_SELECTORS, {
      force: true
    });
    if (selector) {
      await page.waitForTimeout(Math.min(500, deadline.slice(500)));
    }
  }

  private async ensureSupportedContent(page: Page): Promise<void> {
    if (await hasVisibleSelector(page, UNSUPPORTED_SELECTORS)) {
      throw createUnsupportedContentError(
        this.name,
        "The requested Twitch stream or VOD is unavailable or requires subscription."
      );
    }

    if (await bodyTextIncludes(page, UNSUPPORTED_TEXT)) {
      throw createUnsupportedContentError(
        this.name,
        "The requested Twitch stream or VOD is unavailable or requires subscription."
      );
    }
  }

  private async waitForVideo(
    page: Page,
    deadline: { slice: (ms: number) => number }
  ): Promise<void> {
    try {
      await page.locator("video").first().waitFor({
        state: "attached",
        timeout: deadline.slice(15_000)
      });
    } catch {
      await this.ensureSupportedContent(page);
      throw createCaptureFailedError(
        "Twitch player did not become ready before the timeout."
      );
    }
  }

  private async ensurePlayback(
    page: Page,
    deadline: { remainingMs: () => number },
    logger: ProviderRuntime["logger"]
  ): Promise<void> {
    const video = page.locator("video").first();
    const isPlaying = async (): Promise<boolean> => await this.isVideoPlaying(video);

    const autoplaySettled = await this.waitForPlayback(
      page,
      isPlaying,
      Math.min(deadline.remainingMs(), 1_500)
    );
    logger.debug(
      { autoplaySettled },
      "Twitch playback status after autoplay grace period"
    );
    if (autoplaySettled) {
      return;
    }

    const playbackStarted = await this.tryStartPlayback(
      page,
      video,
      isPlaying,
      () => deadline.remainingMs(),
      logger
    );
    if (playbackStarted) {
      return;
    }

    throw createCaptureFailedError("Twitch video did not start playback.");
  }

  private async enterFullscreen(
    page: Page,
    deadline: { slice: (ms: number) => number }
  ): Promise<void> {
    await revealPlayerControls(page);
    await page.locator("video").first().click().catch(() => undefined);
    const clickedSelector = await clickFirstVisible(page, FULLSCREEN_SELECTORS);

    if (!clickedSelector) {
      throw createFullscreenError(this.name);
    }

    const enteredFullscreen = await waitForFullscreen(
      page,
      Math.min(5_000, deadline.slice(5_000))
    );

    if (!enteredFullscreen) {
      throw createFullscreenError(this.name);
    }
  }

  private async waitForAdsToClear(
    page: Page,
    deadline: { isExpired: () => boolean }
  ): Promise<number> {
    let adStartedAt: number | null = null;

    while (!deadline.isExpired()) {
      const hasAdBanner = await hasVisibleSelector(page, AD_SELECTORS);

      if (!hasAdBanner) {
        return adStartedAt ? Date.now() - adStartedAt : 0;
      }

      if (!adStartedAt) {
        adStartedAt = Date.now();
      }

      await page.waitForTimeout(250);
    }

    throw createAdTimeoutError(
      this.name,
      adStartedAt ? Date.now() - adStartedAt : 0
    );
  }

  private async isVideoPlaying(
    video: ReturnType<Page["locator"]>
  ): Promise<boolean> {
    return await video
      .evaluate(
        (element) =>
          !(element as HTMLMediaElement).paused &&
          !(element as HTMLMediaElement).ended &&
          (element as HTMLMediaElement).readyState >=
            HTMLMediaElement.HAVE_CURRENT_DATA
      )
      .catch(() => false);
  }

  private async waitForPlayback(
    page: Page,
    isPlaying: () => Promise<boolean>,
    timeoutMs: number
  ): Promise<boolean> {
    const expiresAt = Date.now() + timeoutMs;

    while (Date.now() < expiresAt) {
      if (await isPlaying()) {
        return true;
      }

      await page.waitForTimeout(150);
    }

    return false;
  }

  private async tryStartPlayback(
    page: Page,
    video: ReturnType<Page["locator"]>,
    isPlaying: () => Promise<boolean>,
    getRemainingMs: () => number,
    logger: ProviderRuntime["logger"]
  ): Promise<boolean> {
    const controlLabel =
      (await page
        .locator('[data-a-target="player-play-pause-button"]')
        .first()
        .getAttribute("aria-label")
        .catch(() => null)) ?? "";
    const normalizedLabel = controlLabel.toLowerCase();
    logger.debug({ controlLabel }, "Twitch play/pause control label before fallback");

    const playedViaApi = await video
      .evaluate(async (element) => {
        try {
          await (element as HTMLMediaElement).play();
          return true;
        } catch {
          return false;
        }
      })
      .catch(() => false);
    logger.debug({ playedViaApi }, "Twitch video.play() fallback result");

    if (
      playedViaApi &&
      (await this.waitForPlayback(
        page,
        isPlaying,
        Math.min(getRemainingMs(), 2_000)
      ))
    ) {
      logger.debug("Twitch playback started via video.play()");
      return true;
    }

    if (!normalizedLabel.includes("pause")) {
      const clickedSelector = await clickFirstVisible(page, PLAY_SELECTORS).catch(
        () => undefined
      );
      logger.debug({ clickedSelector }, "Twitch click fallback result");
      if (
        await this.waitForPlayback(
          page,
          isPlaying,
          Math.min(getRemainingMs(), 2_000)
        )
      ) {
        logger.debug("Twitch playback started via visible control click");
        return true;
      }
    }

    await page.keyboard.press(" ").catch(() => undefined);
    logger.debug("Twitch keyboard fallback dispatched");
    if (
      await this.waitForPlayback(page, isPlaying, Math.min(getRemainingMs(), 3_000))
    ) {
      logger.debug("Twitch playback started via keyboard fallback");
      return true;
    }

    return false;
  }
}
