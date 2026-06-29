import { describe, expect, it } from "vitest";

import { loadConfig } from "../../src/config";

describe("loadConfig", () => {
  it("parses the Twitch runtime settings", () => {
    const config = loadConfig({
      TWITCH_ALLOWED_HOSTS: "twitch.tv,www.twitch.tv,127.0.0.1:8080",
      CAPTURE_TIMEOUT_MS: "240000",
      HEADLESS: "false"
    });

    expect(config.twitchAllowedHosts).toEqual([
      "twitch.tv",
      "www.twitch.tv",
      "127.0.0.1:8080"
    ]);
    expect(config.captureTimeoutMs).toBe(240_000);
    expect(config.headless).toBe(false);
  });

  it("defaults to 20 concurrent captures", () => {
    const config = loadConfig({});

    expect(config.maxConcurrentCaptures).toBe(20);
  });
});
