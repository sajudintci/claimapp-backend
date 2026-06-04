import "reflect-metadata";
import bcrypt from "bcrypt";
import { initDatabase, sequelize } from "@/database/sequelize";
import { OrganizationModel } from "@/database/models/organization.model";
import { DepartmentModel } from "@/database/models/department.model";
import { RoleModel } from "@/database/models/role.model";
import { UserModel } from "@/database/models/user.model";
import { UserRoleModel } from "@/database/models/user-role.model";
import { createId } from "@/utils/id";
import { env } from "@/config/env";
import { ensureOrganizationOcrCredits } from "@/modules/ocr-credits/application/ocr-credits.service";

const DEFAULTS = {
  orgCode: "abby-insurance",
  orgName: "Abby Insurance Group",
  deptName: "Operations",
  roleName: "Super Admin",
  userName: "Super Admin",
  email: "superadmin@claimora.local",
  password: "SuperAdmin123!",
};

async function upsertSuperAdmin() {
  await initDatabase();

  let org = await OrganizationModel.findOne({ where: { code: DEFAULTS.orgCode } });
  if (!org) {
    const quota = env.OCR_CREDITS_MONTHLY_QUOTA;
    const period = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}`;
    org = await OrganizationModel.create({
      id: createId(),
      name: DEFAULTS.orgName,
      code: DEFAULTS.orgCode,
      ocrCreditsRemaining: quota,
      ocrMonthlyQuota: quota,
      ocrCreditsUsedThisMonth: 0,
      ocrCreditsPeriod: period,
    } as never);
  }

  await ensureOrganizationOcrCredits(org.id);

  let dept = await DepartmentModel.findOne({
    where: { organizationId: org.id, name: DEFAULTS.deptName },
  });
  if (!dept) {
    dept = await DepartmentModel.create({
      id: createId(),
      organizationId: org.id,
      name: DEFAULTS.deptName,
    } as never);
  }

  let role = await RoleModel.findOne({ where: { name: DEFAULTS.roleName } });
  if (!role) {
    role = await RoleModel.create({
      id: createId(),
      name: DEFAULTS.roleName,
    } as never);
  }

  const passwordHash = await bcrypt.hash(DEFAULTS.password, 10);
  let user = await UserModel.findOne({ where: { email: DEFAULTS.email } });
  if (!user) {
    user = await UserModel.create({
      id: createId(),
      organizationId: org.id,
      departmentId: dept.id,
      name: DEFAULTS.userName,
      email: DEFAULTS.email,
      passwordHash,
      isActive: true,
    } as never);
  } else {
    await user.update({
      organizationId: org.id,
      departmentId: dept.id,
      name: DEFAULTS.userName,
      isActive: true,
      passwordHash,
    } as never);
  }

  const existingUserRole = await UserRoleModel.findOne({
    where: { userId: user.id, roleId: role.id },
  });
  if (!existingUserRole) {
    await UserRoleModel.create({
      id: createId(),
      userId: user.id,
      roleId: role.id,
    } as never);
  }

  // eslint-disable-next-line no-console
  console.log("Super admin ready:");
  // eslint-disable-next-line no-console
  console.log(`email: ${DEFAULTS.email}`);
  // eslint-disable-next-line no-console
  console.log(`password: ${DEFAULTS.password}`);
}

upsertSuperAdmin()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Failed creating super admin:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });
