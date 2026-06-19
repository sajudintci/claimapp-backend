import { Sequelize } from "sequelize-typescript";
import { env } from "@/config/env";
import { logger } from "@/infrastructure/logger/winston";
import { OrganizationModel } from "./models/organization.model";
import { UserModel } from "./models/user.model";
import { RoleModel } from "./models/role.model";
import { PermissionModel } from "./models/permission.model";
import { UserRoleModel } from "./models/user-role.model";
import { RolePermissionModel } from "./models/role-permission.model";
import { DepartmentModel } from "./models/department.model";
import { ClaimModel } from "./models/claim.model";
import { ClaimDocumentModel } from "./models/claim-document.model";
import { ExtractionJobModel } from "./models/extraction-job.model";
import { ExtractionResultModel } from "./models/extraction-result.model";
import { AuditLogModel } from "./models/audit-log.model";
import { RefreshTokenModel } from "./models/refresh-token.model";
import { NotificationModel } from "./models/notification.model";
import { OcrCreditTransactionModel } from "./models/ocr-credit-transaction.model";
import { OutboxMessageModel } from "./models/outbox-message.model";
import { backfillOrganizationOcrCredits } from "@/modules/ocr-credits/application/ocr-credits.service";
import { ensureOcrCreditsSchema } from "./migrations/ensure-ocr-credits-schema";
import { ensureUserAvatarSchema } from "./migrations/ensure-user-avatar-schema";
import { ensureOutboxSchema } from "./migrations/ensure-outbox-schema";
import { ensureClaimMetadataSchema } from "./migrations/ensure-claim-metadata-schema";
import { ensureClaimReviewerSchema } from "./migrations/ensure-claim-reviewer-schema";
import { ensureExtractionJobProgressSchema } from "./migrations/ensure-extraction-job-progress-schema";

export const sequelize = new Sequelize(env.DATABASE_URL, {
  dialect: "postgres",
  logging: false,
  models: [
    OrganizationModel,
    UserModel,
    RoleModel,
    PermissionModel,
    UserRoleModel,
    RolePermissionModel,
    DepartmentModel,
    ClaimModel,
    ClaimDocumentModel,
    ExtractionJobModel,
    ExtractionResultModel,
    AuditLogModel,
    RefreshTokenModel,
    NotificationModel,
    OcrCreditTransactionModel,
    OutboxMessageModel,
  ],
});

function databaseNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const name = parsed.pathname.replace(/^\//, "");
    return name || "postgres";
  } catch {
    return "(unknown)";
  }
}

export async function initDatabase() {
  try {
    await sequelize.authenticate();
  } catch (err) {
    const code =
      (err as { parent?: { code?: string }; original?: { code?: string } })
        .parent?.code ??
      (err as { original?: { code?: string } }).original?.code;

    if (code === "3D000") {
      const db = databaseNameFromUrl(env.DATABASE_URL);
      logger.error(
        `PostgreSQL database "${db}" does not exist (error 3D000). ` +
          `Create it on the server (CREATE DATABASE ${db};) or set DATABASE_URL to an existing database name. ` +
          `On Coolify/Docker, configure DATABASE_URL in the app Environment tab — the local .env file is not used in production.`,
      );
    }
    throw err;
  }
  await ensureOcrCreditsSchema(sequelize);
  await ensureUserAvatarSchema(sequelize);
  await ensureOutboxSchema(sequelize);
  await ensureClaimReviewerSchema(sequelize);
  await ensureClaimMetadataSchema(sequelize);
  await ensureExtractionJobProgressSchema(sequelize);
  await sequelize.sync();
  await backfillOrganizationOcrCredits();
  logger.info("Database initialized");
}
