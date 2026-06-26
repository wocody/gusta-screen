import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/api/app";
import {
  createUnsupportedUrlError,
  createAdTimeoutError
} from "../../src/errors";
import { createLogger } from "../../src/logger";
import { createTestConfig } from "../helpers/test-config";

describe("HTTP app", () => {
  const logger = createLogger(createTestConfig());
  const apps = new Set<ReturnType<typeof createApp>>();

  afterEach(async () => {
    for (const app of apps) {
      await app.close();
    }

    apps.clear();
  });

  it("returns health status", async () => {
    const app = createApp({
      logger,
      captureService: {
        capture: async () => ({
          provider: "youtube",
          adWaitMs: 0,
          image: Buffer.from("unused")
        })
      }
    });
    apps.add(app);

    const response = await app.inject({
      method: "GET",
      url: "/health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("maps body validation errors to HTTP 400", async () => {
    const app = createApp({
      logger,
      captureService: {
        capture: async () => ({
          provider: "youtube",
          adWaitMs: 0,
          image: Buffer.from("unused")
        })
      }
    });
    apps.add(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/screenshot",
      payload: {}
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: {
        code: "invalid_request",
        message:
          "Request body must be a JSON object containing a non-empty url string."
      }
    });
  });

  it("maps unsupported URL errors to HTTP 422", async () => {
    const app = createApp({
      logger,
      captureService: {
        capture: async () => {
          throw createUnsupportedUrlError(
            "https://example.com",
            "Only YouTube and Twitch URLs are supported."
          );
        }
      }
    });
    apps.add(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/screenshot",
      payload: { url: "https://example.com" }
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      error: {
        code: "unsupported_url",
        message: "Only YouTube and Twitch URLs are supported.",
        details: {
          url: "https://example.com"
        }
      }
    });
  });

  it("maps ad timeout errors to HTTP 504", async () => {
    const app = createApp({
      logger,
      captureService: {
        capture: async () => {
          throw createAdTimeoutError("youtube", 2_000);
        }
      }
    });
    apps.add(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/screenshot",
      payload: { url: "https://www.youtube.com/watch?v=abc123" }
    });

    expect(response.statusCode).toBe(504);
    expect(response.json()).toEqual({
      error: {
        code: "ad_timeout",
        message: "Timed out while waiting for youtube advertisement to finish.",
        details: {
          provider: "youtube",
          waitedMs: 2_000
        }
      }
    });
  });
});
