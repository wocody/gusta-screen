import { bootstrapGoogleAuthProfile } from "../auth/google-auth";
import { loadConfig } from "../config";
import { createLogger } from "../logger";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);

  try {
    const result = await bootstrapGoogleAuthProfile(config, logger);
    logger.info(result, "Google manual bootstrap completed");
  } catch (error) {
    logger.error({ err: error }, "Google manual bootstrap failed");
    process.exitCode = 1;
  }
}

void main();
