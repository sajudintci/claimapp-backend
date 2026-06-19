import bcrypt from "bcrypt";
import { Op } from "sequelize";
import { sequelize } from "@/database/sequelize";
import { UserModel } from "@/database/models/user.model";
import { DepartmentModel } from "@/database/models/department.model";
import { RoleModel } from "@/database/models/role.model";
import { UserRoleModel } from "@/database/models/user-role.model";
import { RefreshTokenModel } from "@/database/models/refresh-token.model";
import { createId } from "@/utils/id";
import { mapUserListItem } from "@/modules/identity-access/application/user-mapper";
import { getStorageService } from "@/storage/storage.factory";

const AVATAR_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const userIncludes = [
  { model: DepartmentModel, attributes: ["id", "name"], required: false },
  {
    model: RoleModel,
    attributes: ["id", "name"],
    through: { attributes: [] },
    required: false,
  },
];

export async function loadUserForOrg(userId: string, organizationId: string) {
  return UserModel.findOne({
    where: { id: userId, organizationId },
    include: userIncludes,
  });
}

export async function getUserFormOptions(organizationId: string) {
  const [departments, roles] = await Promise.all([
    DepartmentModel.findAll({
      where: { organizationId },
      attributes: ["id", "name"],
      order: [["name", "ASC"]],
    }),
    RoleModel.findAll({
      attributes: ["id", "name"],
      order: [["name", "ASC"]],
    }),
  ]);
  return {
    departments: departments.map((d) => ({ id: d.id, name: d.name })),
    roles: roles.map((r) => ({ id: r.id, name: r.name })),
  };
}

async function assertEmailAvailable(email: string, excludeUserId?: string) {
  const where: Record<string, unknown> = {
    email: email.trim().toLowerCase(),
  };
  if (excludeUserId) {
    where.id = { [Op.ne]: excludeUserId };
  }
  const existing = await UserModel.findOne({ where });
  if (existing) {
    throw new Error("EMAIL_ALREADY_EXISTS");
  }
}

async function assertDepartmentInOrg(departmentId: string | null | undefined, organizationId: string) {
  if (!departmentId) return;
  const dept = await DepartmentModel.findOne({
    where: { id: departmentId, organizationId },
  });
  if (!dept) {
    throw new Error("DEPARTMENT_NOT_FOUND");
  }
}

async function assertRolesExist(roleIds: string[]) {
  if (!roleIds.length) {
    throw new Error("ROLE_REQUIRED");
  }
  const roles = await RoleModel.findAll({ where: { id: roleIds } });
  if (roles.length !== roleIds.length) {
    throw new Error("ROLE_NOT_FOUND");
  }
}

async function assignRoles(userId: string, roleIds: string[]) {
  await UserRoleModel.destroy({ where: { userId } });
  for (const roleId of roleIds) {
    await UserRoleModel.create({
      id: createId(),
      userId,
      roleId,
    } as never);
  }
}

export async function createOrganizationUser(params: {
  organizationId: string;
  name: string;
  email: string;
  password: string;
  departmentId?: string | null;
  roleIds: string[];
}) {
  const email = params.email.trim().toLowerCase();
  await assertEmailAvailable(email);
  await assertDepartmentInOrg(params.departmentId, params.organizationId);
  await assertRolesExist(params.roleIds);

  const passwordHash = await bcrypt.hash(params.password, 10);
  const userId = createId();

  await sequelize.transaction(async (transaction) => {
    await UserModel.create(
      {
        id: userId,
        organizationId: params.organizationId,
        departmentId: params.departmentId ?? null,
        name: params.name.trim(),
        email,
        passwordHash,
        isActive: true,
      } as never,
      { transaction },
    );
    await UserRoleModel.destroy({ where: { userId }, transaction });
    for (const roleId of params.roleIds) {
      await UserRoleModel.create(
        { id: createId(), userId, roleId } as never,
        { transaction },
      );
    }
  });

  const user = await loadUserForOrg(userId, params.organizationId);
  if (!user) throw new Error("USER_CREATE_FAILED");
  return mapUserListItem(user);
}

export async function updateOrganizationUser(params: {
  organizationId: string;
  userId: string;
  name?: string;
  email?: string;
  password?: string;
  departmentId?: string | null;
  roleIds?: string[];
  isActive?: boolean;
}) {
  const user = await loadUserForOrg(params.userId, params.organizationId);
  if (!user) {
    throw new Error("USER_NOT_FOUND");
  }

  if (params.email) {
    await assertEmailAvailable(params.email, params.userId);
  }
  if (params.departmentId !== undefined) {
    await assertDepartmentInOrg(params.departmentId, params.organizationId);
  }
  if (params.roleIds) {
    await assertRolesExist(params.roleIds);
  }

  await sequelize.transaction(async (transaction) => {
    const updates: Record<string, unknown> = {};
    if (params.name !== undefined) updates.name = params.name.trim();
    if (params.email !== undefined) updates.email = params.email.trim().toLowerCase();
    if (params.departmentId !== undefined) updates.departmentId = params.departmentId;
    if (params.isActive !== undefined) updates.isActive = params.isActive;
    if (params.password?.trim()) {
      updates.passwordHash = await bcrypt.hash(params.password, 10);
      await RefreshTokenModel.destroy({ where: { userId: params.userId }, transaction });
    }

    if (Object.keys(updates).length > 0) {
      await UserModel.update(updates, {
        where: { id: params.userId, organizationId: params.organizationId },
        transaction,
      });
    }

    if (params.roleIds) {
      await UserRoleModel.destroy({ where: { userId: params.userId }, transaction });
      for (const roleId of params.roleIds) {
        await UserRoleModel.create(
          { id: createId(), userId: params.userId, roleId } as never,
          { transaction },
        );
      }
    }
  });

  const refreshed = await loadUserForOrg(params.userId, params.organizationId);
  if (!refreshed) throw new Error("USER_NOT_FOUND");
  return mapUserListItem(refreshed);
}

export async function updateUserAvatar(params: {
  organizationId: string;
  userId: string;
  file: Express.Multer.File;
}) {
  if (!AVATAR_MIME_TYPES.has(params.file.mimetype)) {
    throw new Error("INVALID_AVATAR_TYPE");
  }

  const user = await loadUserForOrg(params.userId, params.organizationId);
  if (!user) {
    throw new Error("USER_NOT_FOUND");
  }

  const storage = getStorageService();
  const saved = await storage.saveAvatar(params.file);
  const previous = user.avatarFileName;

  await UserModel.update(
    { avatarFileName: saved.fileName },
    { where: { id: params.userId, organizationId: params.organizationId } },
  );

  if (previous && previous !== saved.fileName) {
    await storage.deleteAvatarFile(previous);
  }

  const refreshed = await loadUserForOrg(params.userId, params.organizationId);
  if (!refreshed) throw new Error("USER_NOT_FOUND");
  return mapUserListItem(refreshed);
}

export async function removeUserAvatar(params: {
  organizationId: string;
  userId: string;
}) {
  const user = await loadUserForOrg(params.userId, params.organizationId);
  if (!user) {
    throw new Error("USER_NOT_FOUND");
  }

  if (user.avatarFileName) {
    await getStorageService().deleteAvatarFile(user.avatarFileName);
  }

  await UserModel.update(
    { avatarFileName: null },
    { where: { id: params.userId, organizationId: params.organizationId } },
  );

  const refreshed = await loadUserForOrg(params.userId, params.organizationId);
  if (!refreshed) throw new Error("USER_NOT_FOUND");
  return mapUserListItem(refreshed);
}

/** Soft-delete: deactivate account and revoke refresh tokens. */
export async function deleteOrganizationUser(params: {
  organizationId: string;
  userId: string;
  actorUserId: string;
}) {
  if (params.userId === params.actorUserId) {
    throw new Error("CANNOT_DELETE_SELF");
  }

  const user = await loadUserForOrg(params.userId, params.organizationId);
  if (!user) {
    throw new Error("USER_NOT_FOUND");
  }

  await sequelize.transaction(async (transaction) => {
    await UserModel.update(
      { isActive: false },
      { where: { id: params.userId, organizationId: params.organizationId }, transaction },
    );
    await RefreshTokenModel.destroy({ where: { userId: params.userId }, transaction });
  });

  return user;
}
