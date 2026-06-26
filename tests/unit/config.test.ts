import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadConfig } from "../../src/config";

describe("loadConfig", () => {
  it("parses manual Google auth settings", () => {
    const config = loadConfig({
      CHROME_USER_DATA_DIR: ".auth/custom-chrome-profile",
      GOOGLE_STORAGE_STATE_PATH: ".auth/custom-google.json",
      GOOGLE_AUTH_BROWSER_CHANNEL: "chrome",
      GOOGLE_AUTH_TIMEOUT_MS: "240000"
    });

    expect(config.chromeUserDataDir).toBe(
      path.resolve(".auth/custom-chrome-profile")
    );
    expect(config.googleStorageStatePath).toBe(
      path.resolve(".auth/custom-google.json")
    );
    expect(config.googleAuthBrowserChannel).toBe("chrome");
    expect(config.googleAuthTimeoutMs).toBe(240_000);
  });
});
