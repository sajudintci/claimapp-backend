import bcrypt from "bcrypt";
import { OrganizationModel } from "@/database/models/organization.model";
import { DepartmentModel } from "@/database/models/department.model";
import { UserModel } from "@/database/models/user.model";
import { RoleModel } from "@/database/models/role.model";
import { UserRoleModel } from "@/database/models/user-role.model";
import { createId } from "@/utils/id";
import { env } from "@/config/env";

export async function seedAdmin() {
  const quota = env.OCR_CREDITS_MONTHLY_QUOTA;
  const period = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}`;
  const org = await OrganizationModel.create({
    id: createId(),
    name: "Allianz",
    code: "allianz",
    ocrCreditsRemaining: quota,
    ocrMonthlyQuota: quota,
    ocrCreditsUsedThisMonth: 0,
    ocrCreditsPeriod: period,
  } as any);
  const dept = await DepartmentModel.create({ id: createId(), organizationId: org.id, name: "Operations" });
  const role = await RoleModel.create({ id: createId(), name: "Super Admin" });

  const admin = await UserModel.create({
    id: createId(),
    organizationId: org.id,
    departmentId: dept.id,
    name: "Super Admin",
    email: "admin@claimora.local",
    passwordHash: await bcrypt.hash("password123", 10),
    isActive: true
  });

  await UserRoleModel.create({ id: createId(), userId: admin.id, roleId: role.id });
}
