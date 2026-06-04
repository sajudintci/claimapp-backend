import "reflect-metadata";
import { sequelize } from "@/database/sequelize";

async function main() {
  await sequelize.authenticate();
  await sequelize.query('ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "createdBy" UUID;');
  // eslint-disable-next-line no-console
  console.log('Column "claims.createdBy" ensured.');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Failed to fix claims schema:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });
