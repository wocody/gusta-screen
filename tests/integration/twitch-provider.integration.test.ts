import { afterAll, describe, expect, it } from "vitest";

import { PlaywrightBrowserManager } from "../../src/browser/browser-manager";
import { Deadline } from "../../src/capture/deadline";
import { createLogger } from "../../src/logger";
import { TwitchProvider } from "../../src/providers/twitch-provider";
import { createTwitchFixtureHtml } from "../helpers/provider-fixtures";
import { createTestConfig } from "../helpers/test-config";

const config = createTestConfig({
  captureTimeoutMs: 6_000
});
const logger = createLogger(config);
const browserManager = new PlaywrightBrowserManager(config, logger);

afterAll(async () => {
  await browserManager.close();
});

describe("TwitchProvider", () => {
  it("hides the fullscreen info overlay before finishing screenshot preparation", async () => {
    const context = await browserManager.newContext(logger);
    const page = await context.newPage();
    const provider = new TwitchProvider();

    try {
      await page.setContent(
        createTwitchFixtureHtml({
          fullscreenInfoOverlay: true
        }),
        { waitUntil: "load" }
      );

      const result = await provider.prepareForScreenshot({
        page,
        deadline: new Deadline(config.captureTimeoutMs),
        logger
      });

      expect(result.adWaitMs).toBe(0);
      expect(
        await page.evaluate(() => Boolean(document.fullscreenElement))
      ).toBe(true);
      expect(
        await page
          .locator('[data-test-selector="fullscreen-info-overlay"]')
          .first()
          .isVisible()
          .catch(() => false)
      ).toBe(false);
    } finally {
      await context.close().catch(() => undefined);
    }
  });
});
