import dotenv from "dotenv";
import path from "node:path";

dotenv.config();

const DEFAULT_YOUTUBE_HOSTS = [
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com"
];
const DEFAULT_TWITCH_HOSTS = ["twitch.tv", "www.twitch.tv"];
const DEFAULT_INSECURE_HOSTS = ["localhost", "127.0.0.1"];
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

export interface AppConfig {
  host: string;
  port: number;
  logLevel: string;
  prettyLogs: boolean;
  headless: boolean;
  viewportWidth: number;
  viewportHeight: number;
  captureTimeoutMs: number;
  maxConcurrentCaptures: number;
  userAgent: string;
  chromeUserDataDir: string;
  googleStorageStatePath: string;
  googleAuthBrowserChannel: string;
  googleAuthTimeoutMs: number;
  youtubeAllowedHosts: string[];
  twitchAllowedHosts: string[];
  insecureAllowedHosts: string[];
}

function parseNumber(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum = 1
): number {
  const rawValue = env[name];
  if (!rawValue) {
    return fallback;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (Number.isNaN(parsed) || parsed < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}.`);
  }

  return parsed;
}

function parseBoolean(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: boolean
): boolean {
  const rawValue = env[name];
  if (!rawValue) {
    return fallback;
  }

  return rawValue.toLowerCase() === "true";
}

function parseHostList(value: string | undefined, fallback: string[]): string[] {
  const source = value?.trim() ? value : fallback.join(",");

  return source
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    host: env.HOST ?? "0.0.0.0",
    port: parseNumber(env, "PORT", 3000),
    logLevel: env.LOG_LEVEL ?? "info",
    prettyLogs: parseBoolean(
      env,
      "PRETTY_LOGS",
      env.NODE_ENV !== "production"
    ),
    headless: parseBoolean(env, "HEADLESS", true),
    viewportWidth: parseNumber(env, "VIEWPORT_WIDTH", 1920),
    viewportHeight: parseNumber(env, "VIEWPORT_HEIGHT", 1080),
    captureTimeoutMs: parseNumber(env, "CAPTURE_TIMEOUT_MS", 120_000),
    maxConcurrentCaptures: parseNumber(env, "MAX_CONCURRENT_CAPTURES", 1),
    userAgent: env.USER_AGENT ?? DEFAULT_USER_AGENT,
    chromeUserDataDir: path.resolve(
      env.CHROME_USER_DATA_DIR ?? ".auth/chrome-user-data"
    ),
    googleStorageStatePath: path.resolve(
      env.GOOGLE_STORAGE_STATE_PATH ?? ".auth/google-storage-state.json"
    ),
    googleAuthBrowserChannel: env.GOOGLE_AUTH_BROWSER_CHANNEL?.trim() || "chrome",
    googleAuthTimeoutMs: parseNumber(env, "GOOGLE_AUTH_TIMEOUT_MS", 180_000),
    youtubeAllowedHosts: parseHostList(
      env.YOUTUBE_ALLOWED_HOSTS,
      DEFAULT_YOUTUBE_HOSTS
    ),
    twitchAllowedHosts: parseHostList(
      env.TWITCH_ALLOWED_HOSTS,
      DEFAULT_TWITCH_HOSTS
    ),
    insecureAllowedHosts: parseHostList(
      env.INSECURE_ALLOWED_HOSTS,
      DEFAULT_INSECURE_HOSTS
    )
  };
}
