import type { ProviderName } from "../types";

import type { ProviderHandler } from "./base";
import { TwitchProvider } from "./twitch-provider";

export function createProvider(provider: ProviderName): ProviderHandler {
  if (provider !== "twitch") {
    throw new Error(`No Playwright provider is registered for ${provider}.`);
  }

  return new TwitchProvider();
}
