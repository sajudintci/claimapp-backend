import { Router } from "express";
import { authMiddleware } from "@/middlewares/auth.middleware";
import { NotificationModel } from "@/database/models/notification.model";
import { createId } from "@/utils/id";

const router = Router();
router.use(authMiddleware);

function parseNotificationLimit(raw: unknown): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 50;
  return Math.min(200, Math.max(1, Math.floor(parsed)));
}

router.get("/", async (req, res) => {
  const organizationId = req.auth?.org;
  const limit = parseNotificationLimit(req.query.limit);
  const unreadOnly = req.query.unreadOnly === "true";

  const where: Record<string, unknown> = { organizationId };
  if (unreadOnly) {
    where.isRead = false;
  }

  const [items, unread] = await Promise.all([
    NotificationModel.findAll({
      where,
      order: [["createdAt", "DESC"]],
      limit,
    }),
    NotificationModel.count({
      where: { organizationId, isRead: false },
    }),
  ]);

  res.json({ unread, items });
});

router.post("/", async (req, res) => {
  const created = await NotificationModel.create({
    id: createId(),
    organizationId: req.auth!.org,
    type: req.body.type ?? "info",
    title: req.body.title,
    message: req.body.message,
    isRead: false
  } as any);

  res.status(201).json(created);
});

router.patch("/read-all", async (req, res) => {
  await NotificationModel.update(
    { isRead: true },
    { where: { organizationId: req.auth?.org, isRead: false } },
  );
  res.success(null, { code: "DATA_UPDATED", message: "All notifications marked as read" });
});

router.patch("/:id/read", async (req, res) => {
  await NotificationModel.update({ isRead: true }, { where: { id: req.params.id, organizationId: req.auth?.org } });
  res.success(null, { code: "DATA_UPDATED", message: "Notification marked as read" });
});

export const notificationsRoutes = router;
