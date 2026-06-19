import { Router } from "express";
import { authMiddleware } from "@/middlewares/auth.middleware";
import { ClaimModel } from "@/database/models/claim.model";
import { ExtractionJobModel } from "@/database/models/extraction-job.model";
import { getDashboardMetrics } from "@/modules/reports/application/dashboard-metrics.service";
import { getOcrCreditUsage } from "@/modules/ocr-credits/application/ocr-credits.service";

const router = Router();
router.use(authMiddleware);

router.get("/summary", async (req, res) => {
  const org = req.auth?.org;
  const totalClaims = await ClaimModel.count({ where: { organizationId: org } });
  const failedClaims = await ClaimModel.count({ where: { organizationId: org, status: "Failed" } });
  const reviewedClaims = await ClaimModel.count({ where: { organizationId: org, status: "Reviewed" } });
  const needsAttention = await ClaimModel.count({ where: { organizationId: org, status: "Needs Attention" } });
  const queuedJobs = await ExtractionJobModel.count({ where: { status: "QUEUED" } });
  const processingJobs = await ExtractionJobModel.count({ where: { status: "PROCESSING" } });

  const creditUsage = org ? await getOcrCreditUsage(org) : {
    remainingCredits: 0,
    usedThisMonth: 0,
    monthlyQuota: 0,
    expiryDate: new Date().toISOString().slice(0, 10),
  };

  res.json({
    kpis: { totalClaims, failedClaims, reviewedClaims, needsAttention },
    processing: { queuedJobs, processingJobs },
    creditUsage,
  });
});

router.get("/dashboard-metrics", async (req, res) => {
  const org = req.auth?.org;
  if (!org) {
    return res.fail({
      status: 401,
      code: "UNAUTHORIZED",
      message: "Organization context is required",
    });
  }

  const metrics = await getDashboardMetrics(org);
  return res.success(metrics);
});

router.get("/dashboard", async (req, res) => {
  const org = req.auth?.org;
  if (!org) {
    return res.fail({
      status: 401,
      code: "UNAUTHORIZED",
      message: "Organization context is required",
    });
  }

  const metrics = await getDashboardMetrics(org);
  return res.success({
    totalClaims: metrics.kpis.totalUploaded,
    reviewedClaims: metrics.kpis.approved,
    failedClaims: 0,
    trends: {
      totalClaims: metrics.kpis.uploadTrend,
      reviewedClaims: `${metrics.kpis.approvalRate.toFixed(1).replace(".", ",")}%`,
      failedClaims: "-0%",
    },
  });
});

export const reportsRoutes = router;
