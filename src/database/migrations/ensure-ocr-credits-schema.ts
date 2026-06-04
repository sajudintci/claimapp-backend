import type { Sequelize } from "sequelize";
import { env } from "@/config/env";

const DEFAULT_QUOTA = env.OCR_CREDITS_MONTHLY_QUOTA;

export async function ensureOcrCreditsSchema(sequelize: Sequelize): Promise<void> {
  await sequelize.query(`
    ALTER TABLE "organizations"
      ADD COLUMN IF NOT EXISTS "ocrCreditsRemaining" INTEGER NOT NULL DEFAULT ${DEFAULT_QUOTA};
  `);
  await sequelize.query(`
    ALTER TABLE "organizations"
      ADD COLUMN IF NOT EXISTS "ocrMonthlyQuota" INTEGER NOT NULL DEFAULT ${DEFAULT_QUOTA};
  `);
  await sequelize.query(`
    ALTER TABLE "organizations"
      ADD COLUMN IF NOT EXISTS "ocrCreditsUsedThisMonth" INTEGER NOT NULL DEFAULT 0;
  `);
  await sequelize.query(`
    ALTER TABLE "organizations"
      ADD COLUMN IF NOT EXISTS "ocrCreditsPeriod" VARCHAR(255);
  `);

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS "ocr_credit_transactions" (
      "id" UUID PRIMARY KEY,
      "organizationId" UUID NOT NULL REFERENCES "organizations" ("id") ON DELETE CASCADE,
      "claimId" UUID REFERENCES "claims" ("id") ON DELETE SET NULL,
      "extractionJobId" UUID REFERENCES "extraction_jobs" ("id") ON DELETE SET NULL,
      "type" VARCHAR(255) NOT NULL,
      "pageCount" INTEGER NOT NULL,
      "credits" INTEGER NOT NULL,
      "balanceAfter" INTEGER NOT NULL,
      "note" VARCHAR(255),
      "createdAt" TIMESTAMPTZ NOT NULL,
      "updatedAt" TIMESTAMPTZ NOT NULL,
      "deletedAt" TIMESTAMPTZ
    );
  `);

  await sequelize.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS "ocr_credit_transactions_extraction_job_debit"
      ON "ocr_credit_transactions" ("extractionJobId")
      WHERE "type" = 'debit' AND "extractionJobId" IS NOT NULL AND "deletedAt" IS NULL;
  `);
}
