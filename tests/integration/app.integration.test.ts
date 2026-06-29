import { afterAll, describe, expect, it } from "vitest";
import type { BrowserContext, Route } from "playwright";

import { createApp } from "../../src/api/app";
import { PlaywrightBrowserManager } from "../../src/browser/browser-manager";
import {
  PlaywrightCaptureService,
  type CaptureServiceHooks
} from "../../src/capture/capture-service";
import { createLogger } from "../../src/logger";
import { createTestConfig } from "../helpers/test-config";
import { createTwitchFixtureHtml } from "../helpers/provider-fixtures";

const PNG_SIGNATURE = "89504e470d0a1a0a";

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
  overrides: Partial<ReturnType<typeof createTestConfig>> = {}
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
    hooks
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
      expect(response.headers["content-type"]).toContain("image/png");
      expect(response.headers["x-provider"]).toBe("twitch");
      expect(Number(response.headers["x-ad-wait-ms"])).toBeGreaterThanOrEqual(
        500
      );
      expect(response.rawPayload.subarray(0, 8).toString("hex")).toBe(
        PNG_SIGNATURE
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

  it("falls back when Twitch video.play() hangs", async () => {
    const url = "https://www.twitch.tv/hangingplay";
    const app = createIntegrationApp(
      {
        [url]: createTwitchFixtureHtml({
          hangingPlayMs: 1_600
        })
      },
      {
        captureTimeoutMs: 8_000
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

  it("falls back to the Twitch fullscreen hotkey when the control click fails", async () => {
    const url = "https://www.twitch.tv/fullscreenhotkey";
    const app = createIntegrationApp(
      {
        [url]: createTwitchFixtureHtml({
          fullscreenWorks: false,
          fullscreenHotkeyWorks: true
        })
      },
      {
        captureTimeoutMs: 5_000
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

  it("fails when fullscreen cannot be entered", async () => {
    const url = "https://www.twitch.tv/fullscreenfail";
    const app = createIntegrationApp({
      [url]: createTwitchFixtureHtml({
        fullscreenWorks: false
      })
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/screenshot",
        payload: { url }
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({
        error: {
          code: "fullscreen_failed"
        }
      });
    } finally {
      await app.close();
    }
  });
});
