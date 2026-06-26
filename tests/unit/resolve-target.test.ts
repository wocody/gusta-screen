import { describe, expect, it } from "vitest";

import { resolveTargetUrl } from "../../src/url/resolve-target";
import { AppError } from "../../src/errors";
import { createTestConfig } from "../helpers/test-config";

describe("resolveTargetUrl", () => {
  const config = createTestConfig();

  it("accepts standard YouTube watch URLs", () => {
    const result = resolveTargetUrl(
      "https://www.youtube.com/watch?v=abc123",
      config
    );

    expect(result.provider).toBe("youtube");
  });

  it("accepts Twitch VOD URLs", () => {
    const result = resolveTargetUrl(
      "https://www.twitch.tv/videos/123456",
      config
    );

    expect(result.provider).toBe("twitch");
  });

  it("rejects unsupported YouTube URL shapes", () => {
    expect(() =>
      resolveTargetUrl("https://www.youtube.com/shorts/abc123", config)
    ).toThrowError(AppError);
  });

  it("rejects unsupported hosts", () => {
    expect(() =>
      resolveTargetUrl("https://example.com/video", config)
    ).toThrowError(AppError);
  });

  it("allows loopback HTTP URLs for tests only", () => {
    const localConfig = createTestConfig({
      youtubeAllowedHosts: ["127.0.0.1:8080"]
    });
    const result = resolveTargetUrl(
      "http://127.0.0.1:8080/watch?v=fixture",
      localConfig
    );

    expect(result.provider).toBe("youtube");
  });
});
