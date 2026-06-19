import type { Sequelize } from "sequelize";

export async function ensureOutboxSchema(sequelize: Sequelize): Promise<void> {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS "outbox_messages" (
      "id" UUID PRIMARY KEY,
      "eventType" VARCHAR(255) NOT NULL,
      "aggregateType" VARCHAR(255) NOT NULL,
      "aggregateId" UUID NOT NULL,
      "payload" JSONB NOT NULL,
      "status" VARCHAR(32) NOT NULL DEFAULT 'PENDING',
      "publishAttempts" INTEGER NOT NULL DEFAULT 0,
      "lastError" TEXT,
      "publishedAt" TIMESTAMPTZ,
      "createdAt" TIMESTAMPTZ NOT NULL,
      "updatedAt" TIMESTAMPTZ NOT NULL,
      "deletedAt" TIMESTAMPTZ
    );
  `);

  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS "outbox_messages_status_created_at"
      ON "outbox_messages" ("status", "createdAt")
      WHERE "deletedAt" IS NULL;
  `);

  await sequelize.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS "outbox_messages_event_aggregate"
      ON "outbox_messages" ("eventType", "aggregateId")
      WHERE "deletedAt" IS NULL;
  `);
}
