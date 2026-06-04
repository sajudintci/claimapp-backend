import { UserModel } from "@/database/models/user.model";
import { DepartmentModel } from "@/database/models/department.model";
import { RoleModel } from "@/database/models/role.model";
import { buildAvatarUrl } from "@/utils/avatar-url";

export type UserListItemDto = {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  departmentId: string | null;
  departmentName: string | null;
  roles: string[];
  roleIds: string[];
  avatarUrl: string | null;
  createdAt: string;
};

export function mapUserListItem(user: UserModel): UserListItemDto {
  const department = user.get("department") as DepartmentModel | undefined;
  const roles = (user.get("roles") as RoleModel[] | undefined) ?? [];

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    isActive: user.isActive,
    departmentId: user.departmentId ?? null,
    departmentName: department?.name ?? null,
    roles: roles.map((r) => r.name).filter(Boolean),
    roleIds: roles.map((r) => r.id).filter(Boolean),
    avatarUrl: buildAvatarUrl(user.avatarFileName),
    createdAt: user.createdAt.toISOString(),
  };
}
