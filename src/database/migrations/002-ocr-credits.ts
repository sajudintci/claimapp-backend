import { QueryInterface } from "sequelize";

const DEFAULT_QUOTA = Number(process.env.OCR_CREDITS_MONTHLY_QUOTA ?? 16000);

export const up = async ({ sequelize }: { sequelize: QueryInterface["sequelize"] }) => {
  if (!sequelize) return;

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
};

export const down = async () => {
  // Intentionally no-op: dropping columns would lose billing data.
};
