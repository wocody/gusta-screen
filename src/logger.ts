import pino, { type Logger } from "pino";

import type { AppConfig } from "./config";

export type AppLogger = Logger;

function resolvePrettyTransport(config: AppConfig) {
  if (!config.prettyLogs) {
    return undefined;
  }

  try {
    require.resolve("pino-pretty");
  } catch {
    return undefined;
  }

  return {
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "SYS:standard"
    }
  } as const;
}

export function createLogger(config: AppConfig): AppLogger {
  return pino({
    level: config.logLevel,
    base: undefined,
    transport: resolvePrettyTransport(config)
  });
}
