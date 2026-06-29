import type { ProviderName } from "../types";

import type { ProviderHandler } from "./base";
import { TwitchProvider } from "./twitch-provider";

export function createProvider(provider: ProviderName): ProviderHandler {
  void provider;
  return new TwitchProvider();
}
