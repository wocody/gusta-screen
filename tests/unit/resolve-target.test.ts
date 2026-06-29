import { describe, expect, it } from "vitest";

import { AppError } from "../../src/errors";
import { resolveTargetUrl } from "../../src/url/resolve-target";
import { createTestConfig } from "../helpers/test-config";

describe("resolveTargetUrl", () => {
  const config = createTestConfig();

  it("accepts Twitch VOD URLs", () => {
    const result = resolveTargetUrl(
      "https://www.twitch.tv/videos/123456",
      config
    );

    expect(result.provider).toBe("twitch");
  });

  it("accepts Twitch channel URLs", () => {
    const result = resolveTargetUrl("https://www.twitch.tv/somechannel", config);

    expect(result.provider).toBe("twitch");
  });

  it("rejects non-Twitch URLs", () => {
    expect(() =>
      resolveTargetUrl("https://example.com/video", config)
    ).toThrowError(AppError);
  });

  it("rejects unsupported Twitch URL shapes", () => {
    expect(() =>
      resolveTargetUrl("https://www.twitch.tv/directory/game/abc", config)
    ).toThrowError(AppError);
  });

  it("allows loopback HTTP URLs for tests only", () => {
    const localConfig = createTestConfig({
      twitchAllowedHosts: ["127.0.0.1:8080"]
    });
    const result = resolveTargetUrl(
      "http://127.0.0.1:8080/videos/123",
      localConfig
    );

    expect(result.provider).toBe("twitch");
  });
});
