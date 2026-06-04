import { Router } from "express";
import { OrganizationModel } from "@/database/models/organization.model";
import { createId } from "@/utils/id";
import { authMiddleware } from "@/middlewares/auth.middleware";

const router = Router();
router.use(authMiddleware);

router.get("/", async (_req, res) => {
  const items = await OrganizationModel.findAll();
  res.json(items);
});

router.post("/", async (req, res) => {
  const org = await OrganizationModel.create(({ id: createId(), name: req.body.name, code: req.body.code } as any));
  res.status(201).json(org);
});

export const organizationsRoutes = router;
