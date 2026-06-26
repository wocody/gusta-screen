import type { ProviderName } from "../types";

import type { ProviderHandler } from "./base";
import { TwitchProvider } from "./twitch-provider";
import { YouTubeProvider } from "./youtube-provider";

export function createProvider(provider: ProviderName): ProviderHandler {
  if (provider === "youtube") {
    return new YouTubeProvider();
  }

  return new TwitchProvider();
}
