import { authenticateGoogleAccount } from "../auth/google-auth";
import { loadConfig } from "../config";
import { createLogger } from "../logger";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);

  try {
    const storageStatePath = await authenticateGoogleAccount(config, logger);
    logger.info({ storageStatePath }, "Google authentication completed");
  } catch (error) {
    logger.error({ err: error }, "Google authentication failed");
    process.exitCode = 1;
  }
}

void main();
