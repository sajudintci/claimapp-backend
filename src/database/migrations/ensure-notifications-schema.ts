import type { Sequelize } from "sequelize";

export async function ensureNotificationsSchema(sequelize: Sequelize): Promise<void> {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS "notifications" (
      "id" UUID PRIMARY KEY,
      "organizationId" UUID NOT NULL REFERENCES "organizations" ("id") ON DELETE CASCADE,
      "type" VARCHAR(255) NOT NULL DEFAULT 'info',
      "title" VARCHAR(255) NOT NULL,
      "message" TEXT NOT NULL,
      "isRead" BOOLEAN NOT NULL DEFAULT false,
      "createdAt" TIMESTAMPTZ NOT NULL,
      "updatedAt" TIMESTAMPTZ NOT NULL,
      "deletedAt" TIMESTAMPTZ
    );
  `);

  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS "notifications_org_created_at"
      ON "notifications" ("organizationId", "createdAt" DESC)
      WHERE "deletedAt" IS NULL;
  `);

  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS "notifications_org_unread"
      ON "notifications" ("organizationId", "isRead")
      WHERE "deletedAt" IS NULL AND "isRead" = false;
  `);
}
