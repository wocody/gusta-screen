import type { AppConfig } from "../config";
import { createUnsupportedUrlError } from "../errors";
import type { ProviderName } from "../types";

export interface ResolvedTarget {
  provider: ProviderName;
  normalizedUrl: string;
  url: URL;
}

function hostMatches(url: URL, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const normalizedPattern = pattern.toLowerCase();
    return normalizedPattern.includes(":")
      ? url.host.toLowerCase() === normalizedPattern
      : url.hostname.toLowerCase() === normalizedPattern;
  });
}

function isAllowedScheme(url: URL, config: AppConfig): boolean {
  if (url.protocol === "https:") {
    return true;
  }

  return (
    url.protocol === "http:" &&
    hostMatches(url, config.insecureAllowedHosts)
  );
}

function resolveYouTubeUrl(url: URL): ResolvedTarget {
  if (url.pathname === "/watch" && url.searchParams.get("v")) {
    return { provider: "youtube", normalizedUrl: url.toString(), url };
  }

  if (/^\/live\/[^/]+\/?$/.test(url.pathname)) {
    return { provider: "youtube", normalizedUrl: url.toString(), url };
  }

  throw createUnsupportedUrlError(
    url.toString(),
    "Only standard YouTube watch URLs and /live/<video-id> URLs are supported."
  );
}

function resolveTwitchUrl(url: URL): ResolvedTarget {
  if (/^\/videos\/\d+\/?$/.test(url.pathname)) {
    return { provider: "twitch", normalizedUrl: url.toString(), url };
  }

  if (/^\/[A-Za-z0-9_]+\/?$/.test(url.pathname)) {
    return { provider: "twitch", normalizedUrl: url.toString(), url };
  }

  throw createUnsupportedUrlError(
    url.toString(),
    "Only public Twitch channel and VOD URLs are supported."
  );
}

export function resolveTargetUrl(
  rawUrl: string,
  config: AppConfig
): ResolvedTarget {
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    throw createUnsupportedUrlError(rawUrl, "The provided URL is invalid.");
  }

  if (!isAllowedScheme(url, config)) {
    throw createUnsupportedUrlError(
      rawUrl,
      "Only HTTPS URLs are supported for remote providers."
    );
  }

  if (hostMatches(url, config.youtubeAllowedHosts)) {
    return resolveYouTubeUrl(url);
  }

  if (hostMatches(url, config.twitchAllowedHosts)) {
    return resolveTwitchUrl(url);
  }

  throw createUnsupportedUrlError(
    rawUrl,
    "Only YouTube and Twitch URLs are supported."
  );
}
