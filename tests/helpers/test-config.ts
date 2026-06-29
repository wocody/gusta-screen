import type { AppConfig } from "../../src/config";

export function createTestConfig(
  overrides: Partial<AppConfig> = {}
): AppConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    logLevel: "silent",
    prettyLogs: false,
    headless: true,
    viewportWidth: 1280,
    viewportHeight: 720,
    captureTimeoutMs: 4_000,
    maxConcurrentCaptures: 1,
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    twitchAllowedHosts: ["twitch.tv", "www.twitch.tv"],
    insecureAllowedHosts: ["localhost", "127.0.0.1"],
    ...overrides
  };
}
