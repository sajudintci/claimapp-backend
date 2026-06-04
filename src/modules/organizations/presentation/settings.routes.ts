import { Router } from "express";
import { z } from "zod";
import { authMiddleware } from "@/middlewares/auth.middleware";
import { validateBody } from "@/middlewares/validate.middleware";
import { OrganizationModel } from "@/database/models/organization.model";
import {
  getOrgPreferences,
  updateOrgPreferences,
  type OrganizationSettings,
} from "@/modules/shared/infrastructure/settings-store";

const router = Router();
router.use(authMiddleware);

const patchSettingsSchema = z.object({
  organizationName: z.string().min(2).max(120).optional(),
  timezone: z.string().min(2).max(64).optional(),
  currency: z.string().min(3).max(8).optional(),
  sessionTimeoutMinutes: z.number().int().min(5).max(480).optional(),
  suspiciousLoginAlert: z.boolean().optional(),
});

async function loadSettings(orgId: string): Promise<OrganizationSettings | null> {
  const org = await OrganizationModel.findByPk(orgId);
  if (!org) return null;

  const prefs = getOrgPreferences(orgId);
  return {
    organizationName: org.name,
    organizationCode: org.code,
    timezone: prefs.timezone,
    currency: prefs.currency,
    sessionTimeoutMinutes: prefs.sessionTimeoutMinutes,
    suspiciousLoginAlert: prefs.suspiciousLoginAlert,
    ocrCreditsRemaining: org.ocrCreditsRemaining,
    ocrMonthlyQuota: org.ocrMonthlyQuota,
    ocrCreditsUsedThisMonth: org.ocrCreditsUsedThisMonth,
  };
}

router.get("/", async (req, res) => {
  const data = await loadSettings(req.auth!.org);
  if (!data) {
    return res.fail({
      status: 404,
      code: "ORG_NOT_FOUND",
      message: "Organization not found",
      error: { type: "NotFoundError" },
    });
  }
  return res.success(data);
});

router.patch("/", validateBody(patchSettingsSchema), async (req, res) => {
  const orgId = req.auth!.org;
  const org = await OrganizationModel.findByPk(orgId);
  if (!org) {
    return res.fail({
      status: 404,
      code: "ORG_NOT_FOUND",
      message: "Organization not found",
      error: { type: "NotFoundError" },
    });
  }

  if (req.body.organizationName) {
    await OrganizationModel.update({ name: req.body.organizationName.trim() }, { where: { id: orgId } });
  }

  updateOrgPreferences(orgId, {
    timezone: req.body.timezone,
    currency: req.body.currency,
    sessionTimeoutMinutes: req.body.sessionTimeoutMinutes,
    suspiciousLoginAlert: req.body.suspiciousLoginAlert,
  });

  const data = await loadSettings(orgId);
  return res.success(data, {
    code: "DATA_UPDATED",
    message: "Settings saved successfully",
  });
});

export const settingsRoutes = router;
