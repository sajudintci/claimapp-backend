import "reflect-metadata";
import { createApp } from "@/app";
import { env } from "@/config/env";
import { initDatabase } from "@/database/sequelize";
import { initExtractionQueue } from "@/queue/extraction-queue";
import { initOutboxRelay } from "@/queue/outbox-relay";
import { logger } from "@/infrastructure/logger/winston";
import { getStorageService } from "@/storage/storage.factory";
import { registerProcessErrorHandlers } from "@/infrastructure/logger/log-error";

async function bootstrap() {
  registerProcessErrorHandlers();
  await initDatabase();
  await initOutboxRelay();
  await initExtractionQueue();

  const app = createApp();
  app.listen(env.PORT, () => {
    logger.info("Claimora backend running", {
      port: env.PORT,
      logDir: env.LOG_DIR,
      centralLogging: env.LOG_CENTRAL_ENABLED,
      storageDriver: getStorageService().driver,
      s3Bucket: env.STORAGE_DRIVER === "s3" ? env.S3_BUCKET : undefined,
    });
  });
}

bootstrap().catch((err) => {
  logger.error("Failed to bootstrap", { err });
  process.exit(1);
});
