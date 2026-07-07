import "reflect-metadata";
import type { Server } from "http";
import { createApp } from "@/app";
import { env } from "@/config/env";
import { initDatabase } from "@/database/sequelize";
import { initExtractionQueue, stopExtractionQueue } from "@/queue/extraction-queue";
import { initOutboxRelay, stopOutboxRelay } from "@/queue/outbox-relay";
import { logger } from "@/infrastructure/logger/winston";
import { getStorageService } from "@/storage/storage.factory";
import { registerProcessErrorHandlers } from "@/infrastructure/logger/log-error";

let httpServer: Server | null = null;
let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("Graceful shutdown started", { signal });

  stopOutboxRelay();
  await stopExtractionQueue();

  if (!httpServer) {
    process.exit(0);
    return;
  }

  httpServer.close((err) => {
    if (err) {
      logger.error("HTTP server close failed", { err });
      process.exit(1);
      return;
    }
    logger.info("HTTP server closed");
    process.exit(0);
  });

  setTimeout(() => {
    logger.error("Graceful shutdown timed out");
    process.exit(1);
  }, 15000).unref();
}

async function bootstrap() {
  registerProcessErrorHandlers();
  await initDatabase();
  await initOutboxRelay();
  await initExtractionQueue();

  const app = createApp();
  httpServer = app.listen(env.PORT, () => {
    logger.info("Claimora backend running", {
      port: env.PORT,
      logDir: env.LOG_DIR,
      centralLogging: env.LOG_CENTRAL_ENABLED,
      storageDriver: getStorageService().driver,
      s3Bucket: env.STORAGE_DRIVER === "s3" ? env.S3_BUCKET : undefined,
      runExtractionWorker: env.RUN_EXTRACTION_WORKER,
      runOutboxRelay: env.RUN_OUTBOX_RELAY,
      clusterBulkhead: env.CLUSTER_BULKHEAD_ENABLED,
    });
  });

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
}

bootstrap().catch((err) => {
  logger.error("Failed to bootstrap", { err });
  process.exit(1);
});
