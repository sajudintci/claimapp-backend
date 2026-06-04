import { Op } from "sequelize";
import { sequelize } from "@/database/sequelize";
import { DepartmentModel } from "@/database/models/department.model";
import { UserModel } from "@/database/models/user.model";
import { createId } from "@/utils/id";

export type DepartmentListItem = {
  id: string;
  name: string;
  userCount: number;
  createdAt: string;
};

async function countUsersByDepartment(organizationId: string): Promise<Map<string, number>> {
  const rows = (await UserModel.findAll({
    attributes: [
      "departmentId",
      [sequelize.fn("COUNT", sequelize.col("id")), "count"],
    ],
    where: {
      organizationId,
      departmentId: { [Op.not]: null as unknown as string },
    },
    group: ["departmentId"],
    raw: true,
  })) as unknown as Array<{ departmentId: string; count: string }>;

  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.departmentId) {
      map.set(row.departmentId, Number(row.count) || 0);
    }
  }
  return map;
}

export async function listDepartments(organizationId: string) {
  const [departments, userCounts] = await Promise.all([
    DepartmentModel.findAll({
      where: { organizationId },
      order: [["name", "ASC"]],
    }),
    countUsersByDepartment(organizationId),
  ]);

  const items: DepartmentListItem[] = departments.map((dept) => ({
    id: dept.id,
    name: dept.name,
    userCount: userCounts.get(dept.id) ?? 0,
    createdAt: dept.createdAt.toISOString(),
  }));

  const withUsers = items.filter((d) => d.userCount > 0).length;

  return {
    items,
    summary: {
      total: items.length,
      withUsers,
      empty: items.length - withUsers,
    },
  };
}

async function assertUniqueName(
  organizationId: string,
  name: string,
  excludeId?: string,
) {
  const where: Record<string, unknown> = {
    organizationId,
    name: name.trim(),
  };
  if (excludeId) {
    where.id = { [Op.ne]: excludeId };
  }
  const existing = await DepartmentModel.findOne({ where });
  if (existing) {
    throw new Error("DEPARTMENT_NAME_EXISTS");
  }
}

export async function createDepartment(organizationId: string, name: string) {
  const trimmed = name.trim();
  if (trimmed.length < 2) {
    throw new Error("DEPARTMENT_NAME_INVALID");
  }
  await assertUniqueName(organizationId, trimmed);

  const dept = await DepartmentModel.create({
    id: createId(),
    organizationId,
    name: trimmed,
  } as never);

  return {
    id: dept.id,
    name: dept.name,
    userCount: 0,
    createdAt: dept.createdAt.toISOString(),
  };
}

export async function updateDepartment(
  organizationId: string,
  departmentId: string,
  name: string,
) {
  const trimmed = name.trim();
  if (trimmed.length < 2) {
    throw new Error("DEPARTMENT_NAME_INVALID");
  }

  const dept = await DepartmentModel.findOne({
    where: { id: departmentId, organizationId },
  });
  if (!dept) {
    throw new Error("DEPARTMENT_NOT_FOUND");
  }

  await assertUniqueName(organizationId, trimmed, departmentId);
  await DepartmentModel.update({ name: trimmed }, { where: { id: departmentId } });

  const userCount = await UserModel.count({
    where: { organizationId, departmentId },
  });

  return {
    id: departmentId,
    name: trimmed,
    userCount,
    createdAt: dept.createdAt.toISOString(),
  };
}

export async function deleteDepartment(organizationId: string, departmentId: string) {
  const dept = await DepartmentModel.findOne({
    where: { id: departmentId, organizationId },
  });
  if (!dept) {
    throw new Error("DEPARTMENT_NOT_FOUND");
  }

  const userCount = await UserModel.count({
    where: { organizationId, departmentId },
  });
  if (userCount > 0) {
    throw new Error("DEPARTMENT_IN_USE");
  }

  await DepartmentModel.destroy({ where: { id: departmentId, organizationId } });
  return dept;
}

export async function getDepartmentForOrg(organizationId: string, departmentId: string) {
  const dept = await DepartmentModel.findOne({
    where: { id: departmentId, organizationId },
  });
  if (!dept) return null;

  const userCount = await UserModel.count({
    where: { organizationId, departmentId },
  });

  return {
    id: dept.id,
    name: dept.name,
    userCount,
    createdAt: dept.createdAt.toISOString(),
  };
}
