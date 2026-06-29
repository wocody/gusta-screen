import { describe, expect, it } from "vitest";

import { loadConfig } from "../../src/config";

describe("loadConfig", () => {
  it("parses YouTube RapidAPI settings", () => {
    const config = loadConfig({
      YOUTUBE_RAPIDAPI_KEY: "rapidapi-key",
      YOUTUBE_RAPIDAPI_HOST: "custom-youtube-host.example.com",
      YOUTUBE_RAPIDAPI_BASE_URL: "https://custom-youtube-host.example.com",
      CAPTURE_TIMEOUT_MS: "240000"
    });

    expect(config.youtubeRapidApiKey).toBe("rapidapi-key");
    expect(config.youtubeRapidApiHost).toBe("custom-youtube-host.example.com");
    expect(config.youtubeRapidApiBaseUrl).toBe(
      "https://custom-youtube-host.example.com"
    );
    expect(config.captureTimeoutMs).toBe(240_000);
  });
});
