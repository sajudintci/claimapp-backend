import type { Sequelize } from "sequelize";

export async function ensureExtractionResultJobSchema(sequelize: Sequelize): Promise<void> {
  await sequelize.query(`
    ALTER TABLE "extraction_results"
      ADD COLUMN IF NOT EXISTS "extractionJobId" UUID REFERENCES "extraction_jobs" ("id") ON DELETE SET NULL;
  `);

  await sequelize.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS "extraction_results_extraction_job_id"
      ON "extraction_results" ("extractionJobId")
      WHERE "extractionJobId" IS NOT NULL AND "deletedAt" IS NULL;
  `);
}
