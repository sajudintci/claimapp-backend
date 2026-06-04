import "reflect-metadata";
import { createApp } from "@/app";
import { env } from "@/config/env";
import { initDatabase } from "@/database/sequelize";
import { initExtractionQueue } from "@/queue/extraction-queue";
import { logger } from "@/infrastructure/logger/winston";

async function bootstrap() {
  await initDatabase();
  await initExtractionQueue();

  const app = createApp();
  app.listen(env.PORT, () => {
    logger.info(`Claimora backend running on port ${env.PORT}`);
  });
}

bootstrap().catch((err) => {
  logger.error("Failed to bootstrap", { err });
  process.exit(1);
});
