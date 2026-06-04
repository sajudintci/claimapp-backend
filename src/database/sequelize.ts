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
import { backfillOrganizationOcrCredits } from "@/modules/ocr-credits/application/ocr-credits.service";
import { ensureOcrCreditsSchema } from "./migrations/ensure-ocr-credits-schema";
import { ensureUserAvatarSchema } from "./migrations/ensure-user-avatar-schema";

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
  ],
});

export async function initDatabase() {
  await sequelize.authenticate();
  await ensureOcrCreditsSchema(sequelize);
  await ensureUserAvatarSchema(sequelize);
  await sequelize.sync();
  await backfillOrganizationOcrCredits();
  logger.info("Database initialized");
}
