import fs from "node:fs/promises";
import path from "node:path";

import { chromium, type BrowserContext, type Page } from "playwright";

import type { AppConfig } from "../config";
import type { AppLogger } from "../logger";

const GOOGLE_LOGIN_URL =
  "https://accounts.google.com/ServiceLogin?service=youtube";
const YOUTUBE_HOME_URL = "https://www.youtube.com/";
const GOOGLE_POST_LOGIN_TIMEOUT_MS = 20_000;

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function applyAutomationEvasion(
  context: BrowserContext
): Promise<void> {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", {
      configurable: true,
      get: () => undefined
    });
  });
}

async function clickVisibleButton(
  page: Page,
  selectors: string[],
  options: { force?: boolean } = {}
): Promise<boolean> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();

    try {
      if (!(await locator.isVisible())) {
        continue;
      }

      await locator.click({ timeout: 1_500, force: options.force ?? false });
      return true;
    } catch {
      continue;
    }
  }

  return false;
}

export async function dismissGooglePrompts(page: Page): Promise<void> {
  await clickVisibleButton(
    page,
    [
      'button:has-text("Accept all")',
      'button:has-text("I agree")',
      'button:has-text("Accept")',
      'button:has-text("Not now")',
      'button:has-text("Skip")',
      'button:has-text("Continue")'
    ],
    { force: true }
  ).catch(() => undefined);
}

async function fillGoogleEmailStep(
  page: Page,
  email: string,
  timeoutMs: number
): Promise<void> {
  const emailInput = page
    .locator('input[name="identifier"], input[type="email"]')
    .first();
  await emailInput.waitFor({ state: "visible", timeout: timeoutMs });
  await emailInput.fill(email);
  await clickVisibleButton(page, ["#identifierNext button", "#identifierNext"]);
}

async function fillGooglePasswordStep(
  page: Page,
  password: string,
  timeoutMs: number
): Promise<void> {
  const passwordInput = page
    .locator(
      'input[name="Passwd"], input[autocomplete="current-password"], input[type="password"]:not([name="hiddenPassword"])'
    )
    .first();
  await passwordInput.waitFor({ state: "visible", timeout: timeoutMs });
  await passwordInput.fill(password);
  await clickVisibleButton(page, ["#passwordNext button", "#passwordNext"]);
}

export async function isGoogleSessionReady(page: Page): Promise<boolean> {
  try {
    if (page.url().includes("accounts.google.com")) {
      return false;
    }

    const signedInSignal = await page
      .evaluate(() => {
        const cookies = document.cookie;
        return cookies.includes("SAPISID") || cookies.includes("HSID");
      })
      .catch(() => false);

    if (signedInSignal) {
      return true;
    }

    return await page
      .locator(
        [
          'button#avatar-btn',
          'button[aria-label*="Google Account" i]',
          'a[href*="SignOutOptions"]'
        ].join(",")
      )
      .first()
      .isVisible()
      .catch(() => false);
  } catch {
    return false;
  }
}

export async function isSecureBrowserRejection(page: Page): Promise<boolean> {
  try {
    if (page.url().includes("/rejected")) {
      return true;
    }

    const text = ((await page.locator("body").textContent()) ?? "").toLowerCase();
    return (
      text.includes("this browser or app may not be secure") ||
      text.includes("couldn’t sign you in")
    );
  } catch {
    return false;
  }
}

export async function waitForGoogleSession(
  page: Page,
  timeoutMs: number
): Promise<boolean> {
  const expiresAt = Date.now() + timeoutMs;

  while (Date.now() < expiresAt) {
    await dismissGooglePrompts(page);

    if (await isGoogleSessionReady(page)) {
      return true;
    }

    await page.waitForTimeout(500);
  }

  return false;
}

export async function getGoogleStorageStatePath(
  config: AppConfig
): Promise<string | undefined> {
  if (await fileExists(config.googleStorageStatePath)) {
    return config.googleStorageStatePath;
  }

  return undefined;
}

export async function hasGoogleStorageState(
  config: AppConfig
): Promise<boolean> {
  return await fileExists(config.googleStorageStatePath);
}

export async function authenticateGoogleAccount(
  config: AppConfig,
  logger: AppLogger
): Promise<string> {
  if (!config.googleEmail || !config.googlePassword) {
    throw new Error(
      "GOOGLE_EMAIL and GOOGLE_PASSWORD must be set before running Google authentication."
    );
  }

  await fs.mkdir(path.dirname(config.googleStorageStatePath), {
    recursive: true
  });

  const browser = await chromium.launch({
    headless: config.googleAuthHeadless,
    channel: config.googleAuthBrowserChannel,
    args: [
      "--autoplay-policy=no-user-gesture-required",
      "--disable-blink-features=AutomationControlled"
    ]
  });

  const context = await browser.newContext({
    viewport: {
      width: config.viewportWidth,
      height: config.viewportHeight
    },
    userAgent: config.userAgent,
    locale: "en-US"
  });
  await applyAutomationEvasion(context);
  const page = await context.newPage();

  try {
    logger.info(
      {
        storageStatePath: config.googleStorageStatePath,
        headless: config.googleAuthHeadless
      },
      "Starting Google authentication flow"
    );

    await page.goto(GOOGLE_LOGIN_URL, {
      waitUntil: "domcontentloaded",
      timeout: config.googleAuthTimeoutMs
    });
    await dismissGooglePrompts(page);

    await fillGoogleEmailStep(page, config.googleEmail, config.googleAuthTimeoutMs);
    await dismissGooglePrompts(page);
    if (await isSecureBrowserRejection(page)) {
      throw new Error(
        "Google blocked automated sign-in for this browser session before the password step."
      );
    }

    await fillGooglePasswordStep(
      page,
      config.googlePassword,
      config.googleAuthTimeoutMs
    );

    let authenticated = await waitForGoogleSession(
      page,
      GOOGLE_POST_LOGIN_TIMEOUT_MS
    );

    if (!authenticated && !config.googleAuthHeadless) {
      logger.warn(
        "Google may require manual verification. Complete the sign-in in the opened Chrome window."
      );
      authenticated = await waitForGoogleSession(page, config.googleAuthTimeoutMs);
    }

    if (!authenticated) {
      if (await isSecureBrowserRejection(page)) {
        throw new Error(
          "Google blocked automated sign-in for this browser session. Open Chrome and complete the login manually through `pnpm auth:google`."
        );
      }

      throw new Error(
        "Google authentication did not complete. The account may require additional verification or manual approval."
      );
    }

    await page.goto(YOUTUBE_HOME_URL, {
      waitUntil: "domcontentloaded",
      timeout: config.googleAuthTimeoutMs
    });

    await context.storageState({ path: config.googleStorageStatePath });

    logger.info(
      { storageStatePath: config.googleStorageStatePath },
      "Google storage state saved"
    );

    return config.googleStorageStatePath;
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

export async function bootstrapGoogleAuthProfile(
  config: AppConfig,
  logger: AppLogger
): Promise<{
  chromeUserDataDir: string;
  storageStatePath: string;
}> {
  await fs.mkdir(config.chromeUserDataDir, { recursive: true });
  await fs.mkdir(path.dirname(config.googleStorageStatePath), {
    recursive: true
  });

  const context = await chromium.launchPersistentContext(config.chromeUserDataDir, {
    headless: false,
    channel: config.googleAuthBrowserChannel,
    viewport: {
      width: config.viewportWidth,
      height: config.viewportHeight
    },
    userAgent: config.userAgent,
    locale: "en-US",
    args: [
      "--autoplay-policy=no-user-gesture-required",
      "--disable-blink-features=AutomationControlled"
    ]
  });
  await applyAutomationEvasion(context);

  const page = context.pages()[0] ?? (await context.newPage());

  try {
    logger.info(
      {
        chromeUserDataDir: config.chromeUserDataDir,
        storageStatePath: config.googleStorageStatePath
      },
      "Launching persistent Chrome profile for manual Google authentication"
    );

    await page.goto(YOUTUBE_HOME_URL, {
      waitUntil: "domcontentloaded",
      timeout: config.googleAuthTimeoutMs
    });
    await dismissGooglePrompts(page);

    if (!(await isGoogleSessionReady(page))) {
      logger.warn(
        "Complete the Google sign-in manually in the opened browser window or remote desktop session."
      );
      await page.goto(GOOGLE_LOGIN_URL, {
        waitUntil: "domcontentloaded",
        timeout: config.googleAuthTimeoutMs
      });
    }

    const authenticated = await waitForGoogleSession(
      page,
      config.googleAuthTimeoutMs
    );

    if (!authenticated) {
      if (await isSecureBrowserRejection(page)) {
        throw new Error(
          "Google blocked the sign-in flow in this browser session. Retry from a real Chrome desktop or a noVNC/Xvfb session on the VPS."
        );
      }

      throw new Error(
        "Google authentication bootstrap did not complete before the timeout."
      );
    }

    await page.goto(YOUTUBE_HOME_URL, {
      waitUntil: "domcontentloaded",
      timeout: config.googleAuthTimeoutMs
    });
    await context.storageState({ path: config.googleStorageStatePath });

    logger.info(
      {
        chromeUserDataDir: config.chromeUserDataDir,
        storageStatePath: config.googleStorageStatePath
      },
      "Persistent Chrome profile authenticated and storage state exported"
    );

    return {
      chromeUserDataDir: config.chromeUserDataDir,
      storageStatePath: config.googleStorageStatePath
    };
  } finally {
    await context.close().catch(() => undefined);
  }
}
