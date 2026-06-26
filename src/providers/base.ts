import type { Page } from "playwright";

import type { Deadline } from "../capture/deadline";
import type { AppLogger } from "../logger";
import type { ProviderName } from "../types";

export interface ProviderRuntime {
  page: Page;
  deadline: Deadline;
  logger: AppLogger;
}

export interface ProviderHandler {
  readonly name: ProviderName;
  prepareForScreenshot(runtime: ProviderRuntime): Promise<{ adWaitMs: number }>;
}
