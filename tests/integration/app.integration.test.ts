import { afterAll, describe, expect, it } from "vitest";
import type { BrowserContext, Route } from "playwright";

import { createApp } from "../../src/api/app";
import { PlaywrightBrowserManager } from "../../src/browser/browser-manager";
import {
  type CaptureServiceDependencies,
  PlaywrightCaptureService,
  type CaptureServiceHooks
} from "../../src/capture/capture-service";
import { createLogger } from "../../src/logger";
import type { YouTubeImageClient } from "../../src/youtube/rapidapi-client";
import { createTestConfig } from "../helpers/test-config";
import { createTwitchFixtureHtml } from "../helpers/provider-fixtures";

const PNG_SIGNATURE = "89504e470d0a1a0a";
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yF9kAAAAASUVORK5CYII=",
  "base64"
);

const config = createTestConfig({
  captureTimeoutMs: 2_500
});
const logger = createLogger(config);
const browserManager = new PlaywrightBrowserManager(config, logger);

async function installFixtureRoutes(
  context: BrowserContext,
  fixtures: Record<string, string>
): Promise<void> {
  await context.route("**/*", async (route: Route) => {
    const body = fixtures[route.request().url()];
    if (body) {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: "text/plain",
      body: "not found"
    });
  });
}

function createIntegrationApp(
  fixtures: Record<string, string>,
  overrides: Partial<ReturnType<typeof createTestConfig>> = {},
  dependencies: CaptureServiceDependencies = {}
) {
  const runtimeConfig = createTestConfig({
    ...config,
    ...overrides
  });
  const hooks: CaptureServiceHooks = {
    onContextCreated: async (context) => {
      await installFixtureRoutes(context, fixtures);
    }
  };
  const captureService = new PlaywrightCaptureService(
    browserManager,
    runtimeConfig,
    logger,
    hooks,
    dependencies
  );

  return createApp({
    captureService,
    logger
  });
}

afterAll(async () => {
  await browserManager.close();
});

describe("POST /api/screenshot integration", () => {
  it("renders a YouTube image returned by the external media client", async () => {
    const url = "https://www.youtube.com/watch?v=fixture-no-ad";
    const youtubeClient: YouTubeImageClient = {
      fetchImage: async () => ({
        bytes: TINY_PNG,
        contentType: "image/png",
        sourceUrl: "https://images.example.com/fixture.png"
      })
    };
    const app = createIntegrationApp({}, {}, { youtubeClient });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/screenshot",
        payload: { url }
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("image/png");
      expect(response.headers["x-provider"]).toBe("youtube");
      expect(response.headers["x-ad-wait-ms"]).toBe("0");
      expect(response.rawPayload.subarray(0, 8).toString("hex")).toBe(
        PNG_SIGNATURE
      );
    } finally {
      await app.close();
    }
  });

  it("waits for a finite Twitch ad to finish", async () => {
    const url = "https://www.twitch.tv/videos/123456789";
    const app = createIntegrationApp({
      [url]: createTwitchFixtureHtml({
        startsPaused: false,
        ad: { type: "finite", durationMs: 600 }
      })
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/screenshot",
        payload: { url }
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["x-provider"]).toBe("twitch");
      expect(Number(response.headers["x-ad-wait-ms"])).toBeGreaterThanOrEqual(
        500
      );
    } finally {
      await app.close();
    }
  });

  it("waits for Twitch autoplay to settle before forcing playback", async () => {
    const url = "https://www.twitch.tv/autoplaydelay";
    const app = createIntegrationApp(
      {
        [url]: createTwitchFixtureHtml({
          autoplayStartMs: 1_200
        })
      },
      {
        captureTimeoutMs: 4_000
      }
    );

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/screenshot",
        payload: { url }
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["x-provider"]).toBe("twitch");
    } finally {
      await app.close();
    }
  });

  it("returns 504 when a Twitch ad never finishes", async () => {
    const url = "https://www.twitch.tv/somechannel";
    const app = createIntegrationApp(
      {
        [url]: createTwitchFixtureHtml({
          startsPaused: false,
          ad: { type: "persistent" }
        })
      },
      {
        captureTimeoutMs: 1_800
      }
    );

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/screenshot",
        payload: { url }
      });

      expect(response.statusCode).toBe(504);
      expect(response.json()).toMatchObject({
        error: {
          code: "ad_timeout"
        }
      });
    } finally {
      await app.close();
    }
  });

  it("propagates YouTube media client failures", async () => {
    const url = "https://www.youtube.com/watch?v=fixture-upstream-failure";
    const youtubeClient: YouTubeImageClient = {
      fetchImage: async () => {
        throw new Error("YouTube media API request failed.");
      }
    };
    const app = createIntegrationApp({}, {}, { youtubeClient });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/screenshot",
        payload: { url }
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({
        error: {
          code: "capture_failed",
          message: "YouTube media API request failed."
        }
      });
    } finally {
      await app.close();
    }
  });
});
