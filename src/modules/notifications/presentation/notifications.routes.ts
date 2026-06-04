import { Router } from "express";
import { authMiddleware } from "@/middlewares/auth.middleware";
import { NotificationModel } from "@/database/models/notification.model";
import { createId } from "@/utils/id";

const router = Router();
router.use(authMiddleware);

router.get("/", async (req, res) => {
  const items = await NotificationModel.findAll({
    where: { organizationId: req.auth?.org },
    order: [["createdAt", "DESC"]],
    limit: 50
  });

  const unread = items.filter((n) => !n.isRead).length;
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
