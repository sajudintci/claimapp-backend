import type { Sequelize } from "sequelize";

export async function ensureOcrPreprocessHistorySchema(sequelize: Sequelize): Promise<void> {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS "ocr_preprocess_histories" (
      "id" UUID PRIMARY KEY,
      "claimId" UUID NOT NULL REFERENCES "claims"("id") ON DELETE CASCADE,
      "extractionJobId" UUID NOT NULL REFERENCES "extraction_jobs"("id") ON DELETE CASCADE,
      "source" VARCHAR(64) NOT NULL,
      "payload" JSONB NOT NULL,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "deletedAt" TIMESTAMPTZ
    );
  `);

  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS "ocr_preprocess_histories_claim_id_created_at_idx"
      ON "ocr_preprocess_histories" ("claimId", "createdAt" DESC);
  `);

  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS "ocr_preprocess_histories_extraction_job_id_idx"
      ON "ocr_preprocess_histories" ("extractionJobId");
  `);
}
