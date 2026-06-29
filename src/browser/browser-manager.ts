import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions
} from "playwright";

import type { AppConfig } from "../config";
import type { AppLogger } from "../logger";

export interface BrowserManager {
  newContext(logger?: AppLogger): Promise<BrowserContext>;
  close(): Promise<void>;
}

export class PlaywrightBrowserManager implements BrowserManager {
  private browserPromise?: Promise<Browser>;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: AppLogger
  ) {}

  async newContext(logger: AppLogger = this.logger): Promise<BrowserContext> {
    const browser = await this.getBrowser();
    logger.info({ step: "browser:context_create" }, "Creating browser context");
    const context = await browser.newContext(
      createBrowserContextOptions(this.config)
    );

    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", {
        configurable: true,
        get: () => undefined
      });
    });

    logger.info({ step: "browser:context_ready" }, "Browser context created");
    return context;
  }

  async close(): Promise<void> {
    if (!this.browserPromise) {
      return;
    }

    this.logger.info({ step: "browser:close" }, "Closing Playwright browser");
    const browser = await this.browserPromise;
    await browser.close();
    this.browserPromise = undefined;
  }

  private async getBrowser(): Promise<Browser> {
    if (!this.browserPromise) {
      this.logger.info(
        {
          step: "browser:launch",
          headless: this.config.headless,
          viewport: {
            width: this.config.viewportWidth,
            height: this.config.viewportHeight
          }
        },
        "Launching Playwright Chromium browser"
      );

      this.browserPromise = chromium
        .launch({
          headless: this.config.headless,
          args: [
            "--autoplay-policy=no-user-gesture-required",
            "--disable-blink-features=AutomationControlled",
            "--mute-audio"
          ]
        })
        .then((browser) => {
          this.logger.info(
            { step: "browser:launch_ready" },
            "Playwright Chromium browser ready"
          );
          return browser;
        })
        .catch((error: unknown) => {
          this.browserPromise = undefined;
          this.logger.error(
            { step: "browser:launch_failed", err: error },
            "Failed to launch Playwright Chromium browser"
          );
          throw error;
        });
    }

    return await this.browserPromise;
  }
}

export function createBrowserContextOptions(
  config: AppConfig
): BrowserContextOptions {
  return {
    viewport: {
      width: config.viewportWidth,
      height: config.viewportHeight
    },
    userAgent: config.userAgent,
    locale: "en-US"
  };
}
