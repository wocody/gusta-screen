import type { Page } from "playwright";

import { createUnsupportedContentError, createAdTimeoutError, createCaptureFailedError, createFullscreenError } from "../errors";
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
  'button:has-text("Accept all")',
  'button:has-text("I agree")',
  'button:has-text("Accept")',
  'form[action*="consent"] button'
];
const SIMPLE_GATE_SELECTORS = [
  'button:has-text("I understand and wish to proceed")',
  'button:has-text("Start watching")',
  'button:has-text("Continue")'
];
const PLAY_SELECTORS = [
  ".ytp-large-play-button",
  "button.ytp-play-button",
  ".ytp-cued-thumbnail-overlay-image"
];
const FULLSCREEN_SELECTORS = [
  "button.ytp-fullscreen-button",
  'button[title*="Full screen" i]',
  'button[aria-label*="Full screen" i]'
];
const SKIP_AD_SELECTORS = [
  ".ytp-ad-skip-button-modern",
  ".ytp-ad-skip-button",
  ".videoAdUiSkipButton"
];
const AD_INDICATOR_SELECTORS = [
  ".ytp-ad-player-overlay",
  ".ytp-ad-preview-container",
  ".video-ads",
  ".ytp-ad-text"
];
const UNSUPPORTED_SELECTORS = [
  "ytd-player-error-message-renderer",
  "#player-unavailable",
  "yt-age-restricted-content-warning-renderer",
  "tp-yt-paper-dialog:has-text('Sign in')"
];
const UNSUPPORTED_TEXT = [
  "sign in to confirm your age",
  "video unavailable",
  "this video is private",
  "members-only",
  "not available in your country"
];

export class YouTubeProvider implements ProviderHandler {
  readonly name = "youtube" as const;

  async prepareForScreenshot({
    page,
    deadline,
    logger
  }: ProviderRuntime): Promise<{ adWaitMs: number }> {
    logger.info({ step: "youtube:consent" }, "Resolving YouTube consent gates");
    await this.dismissConsent(page, deadline);
    await this.dismissSimpleGate(page, deadline);
    await this.ensureSupportedContent(page);
    await this.waitForVideo(page, deadline);
    await this.ensurePlayback(page, deadline);
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
        "The requested YouTube video is unavailable or requires login."
      );
    }

    if (await bodyTextIncludes(page, UNSUPPORTED_TEXT)) {
      throw createUnsupportedContentError(
        this.name,
        "The requested YouTube video is unavailable or requires login."
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
        "YouTube player did not become ready before the timeout."
      );
    }
  }

  private async ensurePlayback(
    page: Page,
    deadline: { remainingMs: () => number }
  ): Promise<void> {
    const video = page.locator("video").first();
    const isPlaying = async (): Promise<boolean> =>
      await video
        .evaluate(
          (element) =>
            !(element as HTMLMediaElement).paused &&
            !(element as HTMLMediaElement).ended &&
            (element as HTMLMediaElement).readyState >=
              HTMLMediaElement.HAVE_CURRENT_DATA
        )
        .catch(() => false);

    if (await isPlaying()) {
      return;
    }

    await clickFirstVisible(page, PLAY_SELECTORS);
    const expiresAt = Date.now() + Math.min(deadline.remainingMs(), 4_000);
    const firstAttemptDeadline = Date.now() + 600;

    while (Date.now() < firstAttemptDeadline) {
      if (await isPlaying()) {
        return;
      }

      await page.waitForTimeout(150);
    }

    await page.keyboard.press("k").catch(() => undefined);

    while (Date.now() < expiresAt) {
      if (await isPlaying()) {
        return;
      }

      await page.waitForTimeout(150);
    }

    throw createCaptureFailedError("YouTube video did not start playback.");
  }

  private async enterFullscreen(
    page: Page,
    deadline: { slice: (ms: number) => number }
  ): Promise<void> {
    await revealPlayerControls(page);
    await page.locator("#movie_player, .html5-video-player").first().click().catch(() => undefined);
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
      const adShowing = await page
        .evaluate((selectors) => {
          const isVisible = (element: Element | null): boolean => {
            if (!(element instanceof HTMLElement)) {
              return false;
            }

            const style = window.getComputedStyle(element);
            return style.display !== "none" && style.visibility !== "hidden" && element.offsetParent !== null;
          };

          const player = document.querySelector("#movie_player, .html5-video-player");
          const hasAdClass = Boolean(player?.classList.contains("ad-showing"));
          const hasAdSelector = selectors.some((selector) =>
            Array.from(document.querySelectorAll(selector)).some((element) => isVisible(element))
          );
          return hasAdClass || hasAdSelector;
        }, AD_INDICATOR_SELECTORS)
        .catch(() => false);

      if (!adShowing) {
        return adStartedAt ? Date.now() - adStartedAt : 0;
      }

      if (!adStartedAt) {
        adStartedAt = Date.now();
      }

      await clickFirstVisible(page, SKIP_AD_SELECTORS).catch(() => undefined);
      await page.waitForTimeout(250);
    }

    throw createAdTimeoutError(
      this.name,
      adStartedAt ? Date.now() - adStartedAt : 0
    );
  }
}
