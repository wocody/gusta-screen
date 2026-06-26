import pino, { type Logger } from "pino";

import type { AppConfig } from "./config";

export type AppLogger = Logger;

export function createLogger(config: AppConfig): AppLogger {
  return pino({
    level: config.logLevel,
    base: undefined,
    transport: config.prettyLogs
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard"
          }
        }
      : undefined
  });
}
