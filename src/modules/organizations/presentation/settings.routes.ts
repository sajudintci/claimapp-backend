import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { authMiddleware } from "@/middlewares/auth.middleware";
import { validateBody } from "@/middlewares/validate.middleware";
import { OrganizationModel } from "@/database/models/organization.model";
import {
  removeOrganizationLogo,
  updateOrganizationLogo,
} from "@/modules/organizations/application/organization-logo.service";
import {
  getOrgPreferences,
  updateOrgPreferences,
  type OrganizationSettings,
} from "@/modules/shared/infrastructure/settings-store";
import { buildOrganizationLogoUrl } from "@/utils/logo-url";

const router = Router();
router.use(authMiddleware);

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

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
    organizationLogoUrl: buildOrganizationLogoUrl(org.logoFileName),
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

router.post("/logo", logoUpload.single("logo"), async (req, res) => {
  if (!req.file) {
    return res.fail({
      status: 400,
      code: "VALIDATION_ERROR",
      message: "logo image is required",
      error: { type: "ValidationError", details: [{ field: "logo", message: "Required" }] },
    });
  }

  try {
    const result = await updateOrganizationLogo({
      organizationId: req.auth!.org,
      file: req.file,
    });
    const data = await loadSettings(req.auth!.org);
    return res.success(
      { ...data, organizationLogoUrl: result.organizationLogoUrl },
      {
        code: "DATA_UPDATED",
        message: "Organization logo updated",
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Logo upload failed";
    if (message === "INVALID_LOGO_TYPE") {
      return res.fail({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "Logo must be JPEG, PNG, or WebP",
        error: { type: "ValidationError" },
      });
    }
    if (message === "ORG_NOT_FOUND") {
      return res.fail({
        status: 404,
        code: "ORG_NOT_FOUND",
        message: "Organization not found",
        error: { type: "NotFoundError" },
      });
    }
    throw err;
  }
});

router.delete("/logo", async (req, res) => {
  try {
    await removeOrganizationLogo({ organizationId: req.auth!.org });
    const data = await loadSettings(req.auth!.org);
    return res.success(data, {
      code: "DATA_UPDATED",
      message: "Organization logo removed",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Logo removal failed";
    if (message === "ORG_NOT_FOUND") {
      return res.fail({
        status: 404,
        code: "ORG_NOT_FOUND",
        message: "Organization not found",
        error: { type: "NotFoundError" },
      });
    }
    throw err;
  }
});

export const settingsRoutes = router;
