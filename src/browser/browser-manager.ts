import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions
} from "playwright";

import { getGoogleStorageStatePath } from "../auth/google-auth";
import type { AppConfig } from "../config";
import type { AppLogger } from "../logger";

export interface BrowserManager {
  newContext(): Promise<BrowserContext>;
  close(): Promise<void>;
}

export class PlaywrightBrowserManager implements BrowserManager {
  private browserPromise?: Promise<Browser>;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: AppLogger
  ) {}

  async newContext(): Promise<BrowserContext> {
    const browser = await this.getBrowser();
    const contextOptions = await createBrowserContextOptions(this.config);
    if (contextOptions.storageState) {
      this.logger.debug(
        { storageStatePath: contextOptions.storageState },
        "Loading Google storage state into Playwright context"
      );
    }
    const context = await browser.newContext(contextOptions);

    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", {
        configurable: true,
        get: () => undefined
      });
    });

    return context;
  }

  async close(): Promise<void> {
    if (!this.browserPromise) {
      return;
    }

    const browser = await this.browserPromise;
    await browser.close();
    this.browserPromise = undefined;
  }

  private async getBrowser(): Promise<Browser> {
    if (!this.browserPromise) {
      this.browserPromise = chromium.launch({
        headless: this.config.headless,
        args: [
          "--autoplay-policy=no-user-gesture-required",
          "--disable-blink-features=AutomationControlled",
          "--mute-audio"
        ]
      });

      this.logger.info(
        {
          headless: this.config.headless,
          viewport: {
            width: this.config.viewportWidth,
            height: this.config.viewportHeight
          }
        },
        "Launching Playwright Chromium browser"
      );
    }

    return await this.browserPromise;
  }
}

export async function createBrowserContextOptions(
  config: AppConfig
): Promise<BrowserContextOptions> {
  const storageState = await getGoogleStorageStatePath(config);

  return {
    viewport: {
      width: config.viewportWidth,
      height: config.viewportHeight
    },
    userAgent: config.userAgent,
    locale: "en-US",
    ...(storageState ? { storageState } : {})
  };
}
