import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadConfig } from "../../src/config";

describe("loadConfig", () => {
  it("parses Google auth settings", () => {
    const config = loadConfig({
      CHROME_USER_DATA_DIR: ".auth/custom-chrome-profile",
      GOOGLE_STORAGE_STATE_PATH: ".auth/custom-google.json",
      GOOGLE_EMAIL: "user@example.com",
      GOOGLE_PASSWORD: "secret",
      GOOGLE_AUTH_HEADLESS: "true",
      GOOGLE_AUTH_BROWSER_CHANNEL: "chrome",
      GOOGLE_AUTH_TIMEOUT_MS: "240000"
    });

    expect(config.chromeUserDataDir).toBe(
      path.resolve(".auth/custom-chrome-profile")
    );
    expect(config.googleStorageStatePath).toBe(
      path.resolve(".auth/custom-google.json")
    );
    expect(config.googleEmail).toBe("user@example.com");
    expect(config.googlePassword).toBe("secret");
    expect(config.googleAuthHeadless).toBe(true);
    expect(config.googleAuthBrowserChannel).toBe("chrome");
    expect(config.googleAuthTimeoutMs).toBe(240_000);
  });
});
