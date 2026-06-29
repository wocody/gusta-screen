import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PlaywrightBrowserManager } from "../../src/browser/browser-manager";
import { PlaywrightCaptureService } from "../../src/capture/capture-service";
import { createLogger } from "../../src/logger";
import { createTestConfig } from "../helpers/test-config";

const twitchUrl = process.env.SMOKE_TWITCH_URL;
const shouldRun = Boolean(twitchUrl);
const smokeDescribe = shouldRun ? describe : describe.skip;

smokeDescribe("real provider smoke", () => {
  const config = createTestConfig({
    captureTimeoutMs: 120_000
  });
  const logger = createLogger(config);
  const browserManager = new PlaywrightBrowserManager(config, logger);
  const captureService = new PlaywrightCaptureService(
    browserManager,
    config,
    logger
  );

  beforeAll(async () => {
    await browserManager.newContext().then((context) => context.close());
  });

  afterAll(async () => {
    await browserManager.close();
  });

  if (twitchUrl) {
    it(
      "captures a real Twitch URL",
      async () => {
        const result = await captureService.capture(twitchUrl);
        expect(result.provider).toBe("twitch");
        expect(result.image.length).toBeGreaterThan(0);
      },
      180_000
    );
  }
});
