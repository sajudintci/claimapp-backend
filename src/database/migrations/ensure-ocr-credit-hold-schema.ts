import type { Sequelize } from "sequelize";

export async function ensureOcrCreditHoldSchema(sequelize: Sequelize): Promise<void> {
  await sequelize.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS "ocr_credit_transactions_extraction_job_hold"
      ON "ocr_credit_transactions" ("extractionJobId")
      WHERE "type" = 'hold' AND "extractionJobId" IS NOT NULL AND "deletedAt" IS NULL;
  `);
}
