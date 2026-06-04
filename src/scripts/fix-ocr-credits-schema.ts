import "reflect-metadata";
import { sequelize } from "@/database/sequelize";
import { ensureOcrCreditsSchema } from "@/database/migrations/ensure-ocr-credits-schema";
import { backfillOrganizationOcrCredits } from "@/modules/ocr-credits/application/ocr-credits.service";

async function main() {
  await sequelize.authenticate();
  await ensureOcrCreditsSchema(sequelize);
  await backfillOrganizationOcrCredits();
  // eslint-disable-next-line no-console
  console.log("OCR credits schema ensured (organizations columns + ocr_credit_transactions).");
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Failed to fix OCR credits schema:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });
