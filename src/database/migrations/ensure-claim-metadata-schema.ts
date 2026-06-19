import type { Sequelize } from "sequelize";

export async function ensureClaimMetadataSchema(sequelize: Sequelize): Promise<void> {
  await sequelize.query(`
    ALTER TABLE "claims"
      ADD COLUMN IF NOT EXISTS "metadata" JSONB;
  `);
}
