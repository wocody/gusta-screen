import { PlaywrightBrowserManager } from "./browser/browser-manager";
import { PlaywrightCaptureService } from "./capture/capture-service";
import { loadConfig } from "./config";
import { createLogger } from "./logger";
import { createApp } from "./api/app";

async function start(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const browserManager = new PlaywrightBrowserManager(config, logger);
  const captureService = new PlaywrightCaptureService(
    browserManager,
    config,
    logger
  );
  const app = createApp({
    captureService,
    logger,
    onClose: async () => {
      await browserManager.close();
    }
  });

  try {
    await app.listen({ host: config.host, port: config.port });
    logger.info(
      { host: config.host, port: config.port },
      "Screenshot service listening"
    );
  } catch (error) {
    logger.error({ err: error }, "Failed to start HTTP server");
    await browserManager.close().catch(() => undefined);
    process.exitCode = 1;
  }
}

void start();
