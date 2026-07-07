import type { Sequelize } from "sequelize";

export async function ensureOrganizationLogoSchema(sequelize: Sequelize): Promise<void> {
  await sequelize.query(`
    ALTER TABLE "organizations"
      ADD COLUMN IF NOT EXISTS "logoFileName" VARCHAR(255);
  `);
}
