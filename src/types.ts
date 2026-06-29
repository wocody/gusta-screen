export type ProviderName = "twitch";

export interface ScreenshotRequestBody {
  url: string;
}

export interface CaptureResult {
  provider: ProviderName;
  adWaitMs: number;
  image: Buffer;
}
