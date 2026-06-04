import type { Sequelize } from "sequelize";

export async function ensureUserAvatarSchema(sequelize: Sequelize): Promise<void> {
  await sequelize.query(`
    ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "avatarFileName" VARCHAR(255);
  `);
}
