import { Router, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { authMiddleware } from "@/middlewares/auth.middleware";
import { validateBody } from "@/middlewares/validate.middleware";
import { UserModel } from "@/database/models/user.model";
import { DepartmentModel } from "@/database/models/department.model";
import { RoleModel } from "@/database/models/role.model";
import { mapUserListItem } from "@/modules/identity-access/application/user-mapper";
import {
  createOrganizationUser,
  deleteOrganizationUser,
  getUserFormOptions,
  loadUserForOrg,
  removeUserAvatar,
  updateOrganizationUser,
  updateUserAvatar,
} from "@/modules/identity-access/application/users.service";
import { AuditAction } from "@/modules/audit/domain/audit-actions";
import { writeAuditFromRequest } from "@/utils/audit-request";

const router = Router();
router.use(authMiddleware);

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

const createUserSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  departmentId: z.string().uuid().nullable().optional(),
  roleIds: z.array(z.string().uuid()).optional().default([]),
});

const updateUserSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).max(128).optional(),
  departmentId: z.string().uuid().nullable().optional(),
  roleIds: z.array(z.string().uuid()).optional(),
  isActive: z.boolean().optional(),
});

const updateMyProfileSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).max(128).optional(),
});

function mapServiceError(res: Response, err: unknown) {
  const message = err instanceof Error ? err.message : "Request failed";
  const map: Record<string, { status: number; code: string; msg: string }> = {
    USER_NOT_FOUND: { status: 404, code: "USER_NOT_FOUND", msg: "User not found" },
    EMAIL_ALREADY_EXISTS: {
      status: 409,
      code: "EMAIL_ALREADY_EXISTS",
      msg: "Email is already registered",
    },
    DEPARTMENT_NOT_FOUND: {
      status: 400,
      code: "DEPARTMENT_NOT_FOUND",
      msg: "Department not found in your organization",
    },
    ROLE_REQUIRED: { status: 400, code: "ROLE_REQUIRED", msg: "At least one role is required" },
    ROLE_NOT_FOUND: { status: 400, code: "ROLE_NOT_FOUND", msg: "One or more roles are invalid" },
    CANNOT_DELETE_SELF: {
      status: 400,
      code: "CANNOT_DELETE_SELF",
      msg: "You cannot delete your own account",
    },
  };
  const hit = map[message];
  if (hit) {
    return res.fail({
      status: hit.status,
      code: hit.code,
      message: hit.msg,
      error: { type: "ValidationError" },
    });
  }
  throw err;
}

router.get("/form-options", async (req, res) => {
  const options = await getUserFormOptions(req.auth!.org);
  return res.success(options);
});

router.get("/me", async (req, res) => {
  const user = await loadUserForOrg(req.auth!.sub, req.auth!.org);
  if (!user) {
    return res.fail({
      status: 404,
      code: "USER_NOT_FOUND",
      message: "User not found",
      error: { type: "NotFoundError" },
    });
  }
  return res.success(mapUserListItem(user));
});

router.patch("/me", validateBody(updateMyProfileSchema), async (req, res) => {
  const userId = req.auth!.sub;
  try {
    const before = await loadUserForOrg(userId, req.auth!.org);
    if (!before) {
      return res.fail({
        status: 404,
        code: "USER_NOT_FOUND",
        message: "User not found",
        error: { type: "NotFoundError" },
      });
    }

    const updated = await updateOrganizationUser({
      organizationId: req.auth!.org,
      userId,
      name: req.body.name,
      email: req.body.email,
      password: req.body.password,
    });

    await writeAuditFromRequest(req, {
      action: AuditAction.USER_UPDATED,
      entityType: "user",
      entityId: updated.id,
      beforeChanges: { name: before.name, email: before.email },
      afterChanges: { name: updated.name, email: updated.email, selfService: true, result: "Success" },
    });

    return res.success(updated, {
      code: "DATA_UPDATED",
      message: "Profile updated successfully",
    });
  } catch (err) {
    return mapServiceError(res, err);
  }
});

router.post("/me/avatar", avatarUpload.single("avatar"), async (req, res) => {
  if (!req.file) {
    return res.fail({
      status: 400,
      code: "VALIDATION_ERROR",
      message: "avatar image is required",
      error: { type: "ValidationError", details: [{ field: "avatar", message: "Required" }] },
    });
  }

  try {
    const before = await loadUserForOrg(req.auth!.sub, req.auth!.org);
    const updated = await updateUserAvatar({
      organizationId: req.auth!.org,
      userId: req.auth!.sub,
      file: req.file,
    });

    await writeAuditFromRequest(req, {
      action: AuditAction.USER_UPDATED,
      entityType: "user",
      entityId: updated.id,
      beforeChanges: {
        avatarFileName: before?.avatarFileName ?? null,
        avatarUrl: before ? mapUserListItem(before).avatarUrl : null,
      },
      afterChanges: {
        avatarFileName: updated.avatarUrl?.split("/").pop() ?? null,
        avatarUrl: updated.avatarUrl,
        avatarUpdated: true,
      },
    });

    return res.success(updated, {
      code: "DATA_UPDATED",
      message: "Profile photo updated",
    });
  } catch (err) {
    return mapServiceError(res, err);
  }
});

router.delete("/me/avatar", async (req, res) => {
  try {
    const before = await loadUserForOrg(req.auth!.sub, req.auth!.org);
    const updated = await removeUserAvatar({
      organizationId: req.auth!.org,
      userId: req.auth!.sub,
    });

    await writeAuditFromRequest(req, {
      action: AuditAction.USER_UPDATED,
      entityType: "user",
      entityId: updated.id,
      beforeChanges: before
        ? {
            avatarFileName: before.avatarFileName ?? null,
            avatarUrl: mapUserListItem(before).avatarUrl,
          }
        : null,
      afterChanges: { avatarFileName: null, avatarUrl: null, avatarRemoved: true },
    });

    return res.success(updated, {
      code: "DATA_UPDATED",
      message: "Profile photo removed",
    });
  } catch (err) {
    return mapServiceError(res, err);
  }
});

router.get("/", async (req, res) => {
  const org = req.auth?.org;
  const users = await UserModel.findAll({
    where: { organizationId: org },
    include: [
      { model: DepartmentModel, attributes: ["id", "name"], required: false },
      {
        model: RoleModel,
        attributes: ["id", "name"],
        through: { attributes: [] },
        required: false,
      },
    ],
    order: [["name", "ASC"]],
  });

  const items = users.map(mapUserListItem);
  const activeCount = items.filter((u) => u.isActive).length;

  return res.success({
    items,
    summary: {
      total: items.length,
      active: activeCount,
      inactive: items.length - activeCount,
    },
  });
});

router.get("/:id", async (req, res) => {
  const userId = String(req.params.id);
  const user = await loadUserForOrg(userId, req.auth!.org);
  if (!user) {
    return res.fail({
      status: 404,
      code: "USER_NOT_FOUND",
      message: "User not found",
      error: { type: "NotFoundError" },
    });
  }
  return res.success(mapUserListItem(user));
});

router.post("/", validateBody(createUserSchema), async (req, res) => {
  try {
    const { user: created, reactivated } = await createOrganizationUser({
      organizationId: req.auth!.org,
      name: req.body.name,
      email: req.body.email,
      password: req.body.password,
      departmentId: req.body.departmentId ?? null,
      roleIds: req.body.roleIds ?? [],
    });

    await writeAuditFromRequest(req, {
      action: reactivated ? AuditAction.USER_UPDATED : AuditAction.USER_CREATED,
      entityType: "user",
      entityId: created.id,
      afterChanges: {
        email: created.email,
        name: created.name,
        roles: created.roles,
        reactivated,
        result: "Success",
      },
    });

    return res.success({ ...created, reactivated }, {
      status: reactivated ? 200 : 201,
      code: reactivated ? "DATA_UPDATED" : "DATA_CREATED",
      message: reactivated
        ? "Inactive user reactivated with the new details"
        : "User created successfully",
    });
  } catch (err) {
    return mapServiceError(res, err);
  }
});

router.patch("/:id", validateBody(updateUserSchema), async (req, res) => {
  const userId = String(req.params.id);
  try {
    const before = await loadUserForOrg(userId, req.auth!.org);
    if (!before) {
      return res.fail({
        status: 404,
        code: "USER_NOT_FOUND",
        message: "User not found",
        error: { type: "NotFoundError" },
      });
    }

    const updated = await updateOrganizationUser({
      organizationId: req.auth!.org,
      userId,
      name: req.body.name,
      email: req.body.email,
      password: req.body.password,
      departmentId: req.body.departmentId,
      roleIds: req.body.roleIds,
      isActive: req.body.isActive,
    });

    await writeAuditFromRequest(req, {
      action: AuditAction.USER_UPDATED,
      entityType: "user",
      entityId: updated.id,
      beforeChanges: {
        name: before.name,
        email: before.email,
        isActive: before.isActive,
        roles: mapUserListItem(before).roles,
      },
      afterChanges: {
        name: updated.name,
        email: updated.email,
        isActive: updated.isActive,
        roles: updated.roles,
        result: "Success",
      },
    });

    return res.success(updated, {
      code: "DATA_UPDATED",
      message: "User updated successfully",
    });
  } catch (err) {
    return mapServiceError(res, err);
  }
});

router.delete("/:id", async (req, res) => {
  const userId = String(req.params.id);
  try {
    const removed = await deleteOrganizationUser({
      organizationId: req.auth!.org,
      userId,
      actorUserId: req.auth!.sub,
    });

    await writeAuditFromRequest(req, {
      action: AuditAction.USER_DELETED,
      entityType: "user",
      entityId: removed.id,
      beforeChanges: { email: removed.email, isActive: true },
      afterChanges: { isActive: false, result: "Success" },
    });

    return res.success(null, {
      code: "DATA_UPDATED",
      message: "User deactivated successfully",
    });
  } catch (err) {
    return mapServiceError(res, err);
  }
});

router.patch("/:id/deactivate", async (req, res) => {
  const userId = String(req.params.id);
  try {
    const removed = await deleteOrganizationUser({
      organizationId: req.auth!.org,
      userId,
      actorUserId: req.auth!.sub,
    });

    await writeAuditFromRequest(req, {
      action: AuditAction.USER_DEACTIVATED,
      entityType: "user",
      entityId: removed.id,
      beforeChanges: { isActive: true, email: removed.email },
      afterChanges: { isActive: false, result: "Success" },
    });

    return res.success(null, {
      code: "DATA_UPDATED",
      message: "User deactivated successfully",
    });
  } catch (err) {
    return mapServiceError(res, err);
  }
});

export const usersRoutes = router;
