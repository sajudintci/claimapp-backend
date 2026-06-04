import { Router } from "express";
import { Op, type WhereOptions } from "sequelize";
import { authMiddleware } from "@/middlewares/auth.middleware";
import { AuditAction } from "@/modules/audit/domain/audit-actions";
import { AuditLogModel } from "@/database/models/audit-log.model";
import { UserModel } from "@/database/models/user.model";
import { toPagination } from "@/utils/pagination";
import { mapAuditLogRow } from "@/modules/audit/application/audit-mapper";

const router = Router();
router.use(authMiddleware);

router.get("/", async (req, res) => {
  const org = req.auth?.org;
  const { page, limit, action, entityType, result, q } = req.query;
  const pg = toPagination(Number(page), Number(limit) || 25);

  const where: WhereOptions = { organizationId: org };
  if (typeof action === "string" && action.trim()) {
    Object.assign(where, { action: action.trim() });
  }
  if (typeof entityType === "string" && entityType.trim()) {
    Object.assign(where, { entityType: entityType.trim() });
  }
  if (typeof q === "string" && q.trim()) {
    const needle = `%${q.trim()}%`;
    Object.assign(where, {
      [Op.or]: [
        { action: { [Op.iLike]: needle } },
        { entityType: { [Op.iLike]: needle } },
        { entityId: { [Op.iLike]: needle } },
        { ipAddress: { [Op.iLike]: needle } },
      ],
    });
  }

  const { rows, count } = await AuditLogModel.findAndCountAll({
    where,
    include: [
      {
        model: UserModel,
        attributes: ["id", "name", "email"],
        required: false,
      },
    ],
    order: [["createdAt", "DESC"]],
    limit: pg.limit,
    offset: pg.offset,
  });

  let items = rows.map(mapAuditLogRow);

  if (typeof result === "string" && result.trim()) {
    const want = result.trim();
    items = items.filter((row) => row.result === want);
  }

  const totalRows = Number(count);
  const totalPages = Math.max(1, Math.ceil(totalRows / pg.limit));

  return res.success(
    { items },
    {
      pagination: {
        page: pg.page,
        limit: pg.limit,
        totalRows,
        totalPages,
      },
    },
  );
});

router.get("/actions", async (_req, res) => {
  return res.success({ actions: Object.values(AuditAction) });
});

export const auditRoutes = router;
