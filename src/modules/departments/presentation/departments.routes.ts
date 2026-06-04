import { Router, type Response } from "express";
import { z } from "zod";
import { authMiddleware } from "@/middlewares/auth.middleware";
import { validateBody } from "@/middlewares/validate.middleware";
import {
  createDepartment,
  deleteDepartment,
  getDepartmentForOrg,
  listDepartments,
  updateDepartment,
} from "@/modules/departments/application/departments.service";
import { AuditAction } from "@/modules/audit/domain/audit-actions";
import { writeAuditFromRequest } from "@/utils/audit-request";

const router = Router();
router.use(authMiddleware);

const createSchema = z.object({
  name: z.string().min(2).max(120),
});

const updateSchema = z.object({
  name: z.string().min(2).max(120),
});

function mapServiceError(res: Response, err: unknown) {
  const message = err instanceof Error ? err.message : "Request failed";
  const map: Record<string, { status: number; code: string; msg: string }> = {
    DEPARTMENT_NOT_FOUND: {
      status: 404,
      code: "DEPARTMENT_NOT_FOUND",
      msg: "Department not found",
    },
    DEPARTMENT_NAME_EXISTS: {
      status: 409,
      code: "DEPARTMENT_NAME_EXISTS",
      msg: "A department with this name already exists",
    },
    DEPARTMENT_NAME_INVALID: {
      status: 400,
      code: "DEPARTMENT_NAME_INVALID",
      msg: "Department name must be at least 2 characters",
    },
    DEPARTMENT_IN_USE: {
      status: 409,
      code: "DEPARTMENT_IN_USE",
      msg: "Cannot delete a department that still has assigned users",
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

router.get("/", async (req, res) => {
  const data = await listDepartments(req.auth!.org);
  return res.success(data);
});

router.get("/:id", async (req, res) => {
  const item = await getDepartmentForOrg(req.auth!.org, String(req.params.id));
  if (!item) {
    return res.fail({
      status: 404,
      code: "DEPARTMENT_NOT_FOUND",
      message: "Department not found",
      error: { type: "NotFoundError" },
    });
  }
  return res.success(item);
});

router.post("/", validateBody(createSchema), async (req, res) => {
  try {
    const created = await createDepartment(req.auth!.org, req.body.name);

    await writeAuditFromRequest(req, {
      action: AuditAction.DEPARTMENT_CREATED,
      entityType: "department",
      entityId: created.id,
      afterChanges: { name: created.name, result: "Success" },
    });

    return res.success(created, {
      status: 201,
      code: "DATA_CREATED",
      message: "Department created successfully",
    });
  } catch (err) {
    return mapServiceError(res, err);
  }
});

router.patch("/:id", validateBody(updateSchema), async (req, res) => {
  const departmentId = String(req.params.id);
  try {
    const before = await getDepartmentForOrg(req.auth!.org, departmentId);
    if (!before) {
      return res.fail({
        status: 404,
        code: "DEPARTMENT_NOT_FOUND",
        message: "Department not found",
        error: { type: "NotFoundError" },
      });
    }

    const updated = await updateDepartment(req.auth!.org, departmentId, req.body.name);

    await writeAuditFromRequest(req, {
      action: AuditAction.DEPARTMENT_UPDATED,
      entityType: "department",
      entityId: updated.id,
      beforeChanges: { name: before.name },
      afterChanges: { name: updated.name, result: "Success" },
    });

    return res.success(updated, {
      code: "DATA_UPDATED",
      message: "Department updated successfully",
    });
  } catch (err) {
    return mapServiceError(res, err);
  }
});

router.delete("/:id", async (req, res) => {
  const departmentId = String(req.params.id);
  try {
    const removed = await deleteDepartment(req.auth!.org, departmentId);

    await writeAuditFromRequest(req, {
      action: AuditAction.DEPARTMENT_DELETED,
      entityType: "department",
      entityId: removed.id,
      beforeChanges: { name: removed.name },
      afterChanges: { result: "Success" },
    });

    return res.success(null, {
      code: "DATA_DELETED",
      message: "Department deleted successfully",
    });
  } catch (err) {
    return mapServiceError(res, err);
  }
});

export const departmentsRoutes = router;
