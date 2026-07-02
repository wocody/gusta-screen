import type { Locator, Page } from "playwright";

export async function delay(page: Page, durationMs: number): Promise<void> {
  await page.waitForTimeout(durationMs);
}

async function isLocatorVisible(locator: Locator): Promise<boolean> {
  try {
    return await locator.isVisible();
  } catch {
    return false;
  }
}

export async function clickFirstVisible(
  page: Page,
  selectors: string[],
  options: { force?: boolean } = {}
): Promise<string | null> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (!(await isLocatorVisible(locator))) {
      continue;
    }

    await locator.click({ timeout: 1_000, force: options.force ?? false });
    return selector;
  }

  return null;
}

export async function hasVisibleSelector(
  page: Page,
  selectors: string[]
): Promise<boolean> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await isLocatorVisible(locator)) {
      return true;
    }
  }

  return false;
}

export async function bodyTextIncludes(
  page: Page,
  snippets: string[]
): Promise<boolean> {
  const text = (await page.locator("body").textContent().catch(() => "")) ?? "";
  const normalized = text.toLowerCase();

  return snippets.some((snippet) => normalized.includes(snippet.toLowerCase()));
}

export async function waitForFullscreen(
  page: Page,
  timeoutMs: number
): Promise<boolean> {
  const expiresAt = Date.now() + timeoutMs;

  while (Date.now() < expiresAt) {
    const isFullscreen = await page
      .evaluate(() => Boolean(document.fullscreenElement))
      .catch(() => false);

    if (isFullscreen) {
      return true;
    }

    await page.waitForTimeout(100);
  }

  return false;
}

export async function hideCursor(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      * {
        cursor: none !important;
      }
    `
  });
}

export async function moveMouseOutsideViewport(page: Page): Promise<void> {
  await page.mouse.move(-50, -50).catch(() => undefined);
}

export async function revealPlayerControls(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  const x = viewport ? Math.floor(viewport.width / 2) : 960;
  const y = viewport ? Math.floor(viewport.height / 2) : 540;
  await page.mouse.move(x, y);
}
