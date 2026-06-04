import { Router } from "express";
import { authMiddleware } from "@/middlewares/auth.middleware";
import { ExtractionResultModel } from "@/database/models/extraction-result.model";
import { ExtractionJobModel } from "@/database/models/extraction-job.model";
import { ClaimModel } from "@/database/models/claim.model";

const router = Router();
router.use(authMiddleware);

router.get("/results", async (req, res) => {
  const claims = await ClaimModel.findAll({
    where: { organizationId: req.auth?.org },
    attributes: ["id"],
    raw: true
  });
  const claimIds = claims.map((c) => c.id as string);
  const items = await ExtractionResultModel.findAll({
    where: { claimId: claimIds },
    order: [["createdAt", "DESC"]],
    limit: 100
  });
  res.json(items);
});

router.get("/confidence-review", async (req, res) => {
  const claims = await ClaimModel.findAll({
    where: { organizationId: req.auth?.org, status: "Needs Attention" },
    order: [["updatedAt", "DESC"]]
  });
  res.json(claims);
});

router.get("/jobs", async (req, res) => {
  const jobs = await ExtractionJobModel.findAll({ order: [["createdAt", "DESC"]], limit: 200 });
  res.json(jobs);
});

export const extractionRoutes = router;
