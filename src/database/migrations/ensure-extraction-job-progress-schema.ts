import type { Sequelize } from "sequelize";

export async function ensureExtractionJobProgressSchema(sequelize: Sequelize): Promise<void> {
  await sequelize.query(`
    ALTER TABLE "extraction_jobs"
      ADD COLUMN IF NOT EXISTS "progressStage" VARCHAR(32);
  `);
}
