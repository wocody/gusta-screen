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
  moveMouseOutsideViewport,
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
const FULLSCREEN_BUTTON_CLICK_TIMEOUT_MS = 3_000;
const PLAY_PROMISE_TIMEOUT_MS = 1_500;
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
    logger.info(
      { step: "twitch:prepare_start" },
      "Preparing Twitch player for screenshot"
    );
    await this.dismissConsent(page, deadline, logger);
    await this.dismissSimpleGate(page, deadline, logger);
    await this.ensureSupportedContent(page, logger);
    await this.waitForVideo(page, deadline, logger);
    await this.ensurePlayback(page, deadline, logger);
    await this.enterFullscreen(page, deadline, logger);
    const adWaitMs = await this.waitForAdsToClear(page, deadline, logger);
    logger.info(
      { step: "twitch:overlay_settle" },
      "Waiting for Twitch player controls to disappear"
    );
    await hideCursor(page);
    await moveMouseOutsideViewport(page);
    await delay(page, 1_500);
    logger.info(
      { step: "twitch:prepare_complete", adWaitMs },
      "Twitch player is ready for screenshot"
    );
    return { adWaitMs };
  }

  private async dismissConsent(
    page: Page,
    deadline: { slice: (ms: number) => number },
    logger: ProviderRuntime["logger"]
  ): Promise<void> {
    logger.info(
      { step: "twitch:consent_check" },
      "Checking Twitch consent banner"
    );
    const selector = await clickFirstVisible(page, CONSENT_SELECTORS, {
      force: true
    });
    if (selector) {
      logger.info(
        { step: "twitch:consent_dismissed", selector },
        "Dismissed Twitch consent banner"
      );
      await page.waitForTimeout(Math.min(500, deadline.slice(500)));
      return;
    }

    logger.info(
      { step: "twitch:consent_not_present" },
      "No Twitch consent banner was shown"
    );
  }

  private async dismissSimpleGate(
    page: Page,
    deadline: { slice: (ms: number) => number },
    logger: ProviderRuntime["logger"]
  ): Promise<void> {
    logger.info(
      { step: "twitch:gate_check" },
      "Checking Twitch content gates"
    );
    const selector = await clickFirstVisible(page, SIMPLE_GATE_SELECTORS, {
      force: true
    });
    if (selector) {
      logger.info(
        { step: "twitch:gate_dismissed", selector },
        "Dismissed Twitch content gate"
      );
      await page.waitForTimeout(Math.min(500, deadline.slice(500)));
      return;
    }

    logger.info(
      { step: "twitch:gate_not_present" },
      "No Twitch content gate was shown"
    );
  }

  private async ensureSupportedContent(
    page: Page,
    logger: ProviderRuntime["logger"]
  ): Promise<void> {
    if (await hasVisibleSelector(page, UNSUPPORTED_SELECTORS)) {
      logger.warn(
        { step: "twitch:unsupported_content" },
        "Twitch content gate indicates unsupported content"
      );
      throw createUnsupportedContentError(
        this.name,
        "The requested Twitch stream or VOD is unavailable or requires subscription."
      );
    }

    if (await bodyTextIncludes(page, UNSUPPORTED_TEXT)) {
      logger.warn(
        { step: "twitch:unsupported_content" },
        "Twitch page text indicates unsupported content"
      );
      throw createUnsupportedContentError(
        this.name,
        "The requested Twitch stream or VOD is unavailable or requires subscription."
      );
    }

    logger.info(
      { step: "twitch:content_supported" },
      "Twitch content availability checks passed"
    );
  }

  private async waitForVideo(
    page: Page,
    deadline: { slice: (ms: number) => number },
    logger: ProviderRuntime["logger"]
  ): Promise<void> {
    logger.info(
      { step: "twitch:video_wait" },
      "Waiting for Twitch video element"
    );
    try {
      await page.locator("video").first().waitFor({
        state: "attached",
        timeout: deadline.slice(15_000)
      });
      logger.info(
        { step: "twitch:video_ready" },
        "Twitch video element is attached"
      );
    } catch {
      await this.ensureSupportedContent(page, logger);
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

    logger.info(
      { step: "twitch:playback_check" },
      "Waiting for Twitch autoplay grace period"
    );
    const autoplaySettled = await this.waitForPlayback(
      page,
      isPlaying,
      Math.min(deadline.remainingMs(), 1_500)
    );
    if (autoplaySettled) {
      logger.info(
        { step: "twitch:playback_started", strategy: "autoplay" },
        "Twitch playback started automatically"
      );
      return;
    }

    logger.info(
      { step: "twitch:playback_fallbacks" },
      "Twitch autoplay did not start playback, trying fallbacks"
    );
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

    logger.error(
      { step: "twitch:playback_failed" },
      "Twitch playback did not start after all fallback attempts"
    );
    throw createCaptureFailedError("Twitch video did not start playback.");
  }

  private async enterFullscreen(
    page: Page,
    deadline: { slice: (ms: number) => number },
    logger: ProviderRuntime["logger"]
  ): Promise<void> {
    logger.info(
      { step: "twitch:fullscreen_start" },
      "Attempting to enter Twitch fullscreen"
    );
    await revealPlayerControls(page);
    await page.locator("video").first().click().catch(() => undefined);
    const clickedSelector = await this.tryClickFullscreenControl(
      page,
      Math.min(
        FULLSCREEN_BUTTON_CLICK_TIMEOUT_MS,
        deadline.slice(FULLSCREEN_BUTTON_CLICK_TIMEOUT_MS)
      ),
      logger
    );

    if (clickedSelector) {
      logger.info(
        { step: "twitch:fullscreen_click", selector: clickedSelector },
        "Clicked Twitch fullscreen control"
      );

      const enteredViaButton = await waitForFullscreen(
        page,
        Math.min(2_000, deadline.slice(2_000))
      );

      if (enteredViaButton) {
        logger.info(
          { step: "twitch:fullscreen_ready", strategy: "control_click" },
          "Twitch player entered fullscreen"
        );
        return;
      }

      logger.warn(
        { step: "twitch:fullscreen_retry", strategy: "hotkey_f" },
        "Twitch fullscreen control did not enter fullscreen, trying hotkey"
      );
    } else {
      logger.warn(
        { step: "twitch:fullscreen_retry", strategy: "hotkey_f" },
        "Twitch fullscreen control click failed, trying hotkey"
      );
    }

    await revealPlayerControls(page);
    await page.locator("video").first().click().catch(() => undefined);
    await page.keyboard.press("f").catch((error: unknown) => {
      logger.warn(
        {
          step: "twitch:fullscreen_hotkey_failed",
          err: error
        },
        "Failed to dispatch Twitch fullscreen hotkey"
      );
    });

    const enteredViaHotkey = await waitForFullscreen(
      page,
      Math.min(3_000, deadline.slice(3_000))
    );

    if (enteredViaHotkey) {
      logger.info(
        { step: "twitch:fullscreen_ready", strategy: "hotkey_f" },
        "Twitch player entered fullscreen"
      );
      return;
    }

    logger.error(
      { step: "twitch:fullscreen_failed" },
      "Twitch player did not enter fullscreen"
    );
    throw createFullscreenError(this.name);
  }

  private async tryClickFullscreenControl(
    page: Page,
    timeoutMs: number,
    logger: ProviderRuntime["logger"]
  ): Promise<string | null> {
    for (const selector of FULLSCREEN_SELECTORS) {
      const locator = page.locator(selector).first();
      const isVisible = await locator.isVisible().catch(() => false);
      if (!isVisible) {
        continue;
      }

      try {
        await locator.click({
          timeout: timeoutMs,
          noWaitAfter: true
        });
        return selector;
      } catch (error) {
        logger.warn(
          {
            step: "twitch:fullscreen_click_retry",
            selector,
            strategy: "force_click",
            err: error
          },
          "Twitch fullscreen control click failed, retrying with force"
        );

        try {
          await locator.click({
            timeout: Math.min(timeoutMs, 1_000),
            force: true,
            noWaitAfter: true
          });
          return selector;
        } catch (forceError) {
          logger.warn(
            {
              step: "twitch:fullscreen_click_failed",
              selector,
              err: forceError
            },
            "Twitch fullscreen control could not be clicked"
          );
        }
      }
    }

    return null;
  }

  private async waitForAdsToClear(
    page: Page,
    deadline: { isExpired: () => boolean },
    logger: ProviderRuntime["logger"]
  ): Promise<number> {
    let adStartedAt: number | null = null;

    while (!deadline.isExpired()) {
      const hasAdBanner = await hasVisibleSelector(page, AD_SELECTORS);

      if (!hasAdBanner) {
        if (!adStartedAt) {
          logger.info(
            { step: "twitch:ad_clear", adWaitMs: 0 },
            "No Twitch advertisement detected"
          );
          return 0;
        }

        const adWaitMs = Date.now() - adStartedAt;
        logger.info(
          { step: "twitch:ad_clear", adWaitMs },
          "Twitch advertisement finished"
        );
        return adWaitMs;
      }

      if (!adStartedAt) {
        adStartedAt = Date.now();
        logger.info(
          { step: "twitch:ad_detected" },
          "Twitch advertisement detected, waiting for it to finish"
        );
      }

      await page.waitForTimeout(250);
    }

    logger.error(
      {
        step: "twitch:ad_timeout",
        waitedMs: adStartedAt ? Date.now() - adStartedAt : 0
      },
      "Twitch advertisement did not finish before the timeout"
    );
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
    logger.info(
      {
        step: "twitch:playback_control_state",
        controlLabel
      },
      "Checked Twitch play/pause control state"
    );

    const playOutcome = await video
      .evaluate(async (element, timeoutMs: number) => {
        const media = element as HTMLMediaElement;

        try {
          const playPromise = media.play();
          if (!playPromise) {
            return "no_promise";
          }

          return await Promise.race([
            playPromise.then(() => "resolved"),
            new Promise<string>((resolve) => {
              window.setTimeout(() => resolve("timed_out"), timeoutMs);
            })
          ]);
        } catch {
          return "rejected";
        }
      }, PLAY_PROMISE_TIMEOUT_MS)
      .catch(() => "errored");
    logger.info(
      {
        step: "twitch:playback_attempt",
        strategy: "video.play",
        outcome: playOutcome
      },
      "Attempted to start Twitch playback with video.play()"
    );

    if (
      playOutcome === "resolved" &&
      (await this.waitForPlayback(
        page,
        isPlaying,
        Math.min(getRemainingMs(), 2_000)
      ))
    ) {
      logger.info(
        { step: "twitch:playback_started", strategy: "video.play" },
        "Twitch playback started with video.play()"
      );
      return true;
    }

    if (!normalizedLabel.includes("pause")) {
      const clickedSelector = await clickFirstVisible(page, PLAY_SELECTORS).catch(
        () => undefined
      );
      logger.info(
        {
          step: "twitch:playback_attempt",
          strategy: "play_button_click",
          selector: clickedSelector ?? null
        },
        "Attempted to start Twitch playback with visible play control"
      );
      if (
        await this.waitForPlayback(
          page,
          isPlaying,
          Math.min(getRemainingMs(), 2_000)
        )
      ) {
        logger.info(
          { step: "twitch:playback_started", strategy: "play_button_click" },
          "Twitch playback started with visible play control"
        );
        return true;
      }
    }

    await page.keyboard.press(" ").catch(() => undefined);
    logger.info(
      {
        step: "twitch:playback_attempt",
        strategy: "keyboard_space"
      },
      "Attempted to start Twitch playback with keyboard fallback"
    );
    if (
      await this.waitForPlayback(page, isPlaying, Math.min(getRemainingMs(), 3_000))
    ) {
      logger.info(
        { step: "twitch:playback_started", strategy: "keyboard_space" },
        "Twitch playback started with keyboard fallback"
      );
      return true;
    }

    return false;
  }
}
