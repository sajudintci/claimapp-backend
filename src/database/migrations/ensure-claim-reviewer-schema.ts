import type { Sequelize } from "sequelize";

export async function ensureClaimReviewerSchema(sequelize: Sequelize): Promise<void> {
  await sequelize.query(`
    ALTER TABLE "claims"
      ADD COLUMN IF NOT EXISTS "reviewerId" UUID;
  `);

  await sequelize.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'claims_reviewerId_fkey'
      ) THEN
        ALTER TABLE "claims"
          ADD CONSTRAINT "claims_reviewerId_fkey"
          FOREIGN KEY ("reviewerId") REFERENCES "users"("id")
          ON DELETE SET NULL ON UPDATE CASCADE;
      END IF;
    END $$;
  `);

  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS "idx_claims_reviewer_id" ON "claims" ("reviewerId");
  `);
}
