import type { AppConfig } from "../config";
import {
  createCaptureFailedError,
  createUnsupportedContentError
} from "../errors";
import type { AppLogger } from "../logger";
import type { Deadline } from "../capture/deadline";
import type { ResolvedTarget } from "../url/resolve-target";

export interface ExternalImageAsset {
  bytes: Buffer;
  contentType: string;
  sourceUrl: string;
}

export interface YouTubeImageClient {
  fetchImage(
    target: ResolvedTarget,
    deadline: Deadline,
    logger: AppLogger
  ): Promise<ExternalImageAsset>;
}

type FetchLike = typeof fetch;

interface RapidApiThumbnail {
  width?: number;
  height?: number;
  url?: string;
}

interface RapidApiScreenshotSet {
  width?: number;
  height?: number;
  urls?: string[];
}

interface RapidApiMediaResponse {
  main_thumbnail?: RapidApiThumbnail[];
  screenshots?: RapidApiScreenshotSet[];
}

interface MediaCandidate {
  kind: "screenshot" | "thumbnail";
  width: number;
  height: number;
  url: string;
}

function parseErrorMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  const directMessage = record.message;
  if (typeof directMessage === "string" && directMessage.trim()) {
    return directMessage;
  }

  const errorMessage = record.error;
  if (typeof errorMessage === "string" && errorMessage.trim()) {
    return errorMessage;
  }

  return undefined;
}

function isFiniteDimension(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function extractYouTubeVideoId(url: URL): string | undefined {
  if (url.pathname === "/watch") {
    const videoId = url.searchParams.get("v")?.trim();
    return videoId || undefined;
  }

  const liveMatch = url.pathname.match(/^\/live\/([^/]+)\/?$/);
  if (liveMatch?.[1]) {
    return liveMatch[1];
  }

  return undefined;
}

function collectScreenshotCandidates(
  response: RapidApiMediaResponse
): MediaCandidate[] {
  const screenshots = Array.isArray(response.screenshots)
    ? response.screenshots
    : [];

  return screenshots.flatMap((entry) => {
    if (
      !isFiniteDimension(entry.width) ||
      !isFiniteDimension(entry.height) ||
      !Array.isArray(entry.urls) ||
      entry.urls.length === 0
    ) {
      return [];
    }

    const middleIndex = Math.floor(entry.urls.length / 2);
    const url = entry.urls[middleIndex];

    if (typeof url !== "string" || !url.trim()) {
      return [];
    }

    return [
      {
        kind: "screenshot" as const,
        width: entry.width,
        height: entry.height,
        url
      }
    ];
  });
}

function collectThumbnailCandidates(
  response: RapidApiMediaResponse
): MediaCandidate[] {
  const thumbnails = Array.isArray(response.main_thumbnail)
    ? response.main_thumbnail
    : [];

  return thumbnails.flatMap((entry) => {
    if (
      !isFiniteDimension(entry.width) ||
      !isFiniteDimension(entry.height) ||
      typeof entry.url !== "string" ||
      !entry.url.trim()
    ) {
      return [];
    }

    return [
      {
        kind: "thumbnail" as const,
        width: entry.width,
        height: entry.height,
        url: entry.url
      }
    ];
  });
}

function mediaAspectDelta(
  candidate: MediaCandidate,
  viewportWidth: number,
  viewportHeight: number
): number {
  return Math.abs(
    candidate.width / candidate.height - viewportWidth / viewportHeight
  );
}

export function selectBestYouTubeMediaUrl(
  response: RapidApiMediaResponse,
  viewportWidth: number,
  viewportHeight: number
): string | undefined {
  const candidates = [
    ...collectScreenshotCandidates(response),
    ...collectThumbnailCandidates(response)
  ];

  if (candidates.length === 0) {
    return undefined;
  }

  candidates.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "screenshot" ? -1 : 1;
    }

    const aspectDeltaDifference =
      mediaAspectDelta(left, viewportWidth, viewportHeight) -
      mediaAspectDelta(right, viewportWidth, viewportHeight);
    if (Math.abs(aspectDeltaDifference) > 0.001) {
      return aspectDeltaDifference;
    }

    return right.width * right.height - left.width * left.height;
  });

  return candidates[0]?.url;
}

export class RapidApiYouTubeClient implements YouTubeImageClient {
  constructor(
    private readonly config: AppConfig,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  async fetchImage(
    target: ResolvedTarget,
    deadline: Deadline,
    logger: AppLogger
  ): Promise<ExternalImageAsset> {
    if (!this.config.youtubeRapidApiKey) {
      throw createCaptureFailedError(
        "YOUTUBE_RAPIDAPI_KEY is required to capture YouTube images."
      );
    }

    const videoId = extractYouTubeVideoId(target.url);
    if (!videoId) {
      throw createUnsupportedContentError(
        "youtube",
        "Only standard YouTube watch URLs and /live/<video-id> URLs are supported."
      );
    }

    const endpoint = new URL("/medias", this.config.youtubeRapidApiBaseUrl);
    endpoint.searchParams.set("video_id", videoId);

    logger.info(
      {
        step: "youtube:rapidapi:request",
        videoId,
        endpoint: endpoint.toString()
      },
      "Requesting YouTube media metadata from RapidAPI"
    );

    const metadataResponse = await this.fetchImpl(endpoint, {
      method: "GET",
      headers: {
        "x-rapidapi-host": this.config.youtubeRapidApiHost,
        "x-rapidapi-key": this.config.youtubeRapidApiKey
      },
      signal: AbortSignal.timeout(deadline.slice(this.config.captureTimeoutMs))
    });

    const metadataPayload = (await metadataResponse
      .json()
      .catch(() => undefined)) as RapidApiMediaResponse | undefined;

    if (!metadataResponse.ok) {
      const message = parseErrorMessage(metadataPayload);

      if (metadataResponse.status === 400 || metadataResponse.status === 404) {
        throw createUnsupportedContentError(
          "youtube",
          message ||
            "The requested YouTube video is unavailable in the configured media API."
        );
      }

      throw createCaptureFailedError(
        message || "YouTube media API request failed.",
        { statusCode: metadataResponse.status }
      );
    }

    const mediaUrl = selectBestYouTubeMediaUrl(
      metadataPayload ?? {},
      this.config.viewportWidth,
      this.config.viewportHeight
    );

    if (!mediaUrl) {
      throw createUnsupportedContentError(
        "youtube",
        "No screenshot or thumbnail was available for this YouTube video."
      );
    }

    logger.info(
      { step: "youtube:rapidapi:image", mediaUrl },
      "Downloading selected YouTube image"
    );

    const imageResponse = await this.fetchImpl(mediaUrl, {
      method: "GET",
      signal: AbortSignal.timeout(deadline.slice(this.config.captureTimeoutMs))
    });

    if (!imageResponse.ok) {
      if (imageResponse.status === 404) {
        throw createUnsupportedContentError(
          "youtube",
          "The selected YouTube image was not available."
        );
      }

      throw createCaptureFailedError("Failed to download YouTube image.", {
        statusCode: imageResponse.status,
        mediaUrl
      });
    }

    const contentType = imageResponse.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) {
      throw createCaptureFailedError("YouTube media API returned a non-image asset.", {
        contentType,
        mediaUrl
      });
    }

    const bytes = Buffer.from(await imageResponse.arrayBuffer());

    return {
      bytes,
      contentType,
      sourceUrl: mediaUrl
    };
  }
}
