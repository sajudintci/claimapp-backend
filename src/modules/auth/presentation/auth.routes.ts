import { Router } from "express";
import { z } from "zod";
import { AuthService } from "@/modules/auth/application/auth.service";
import { validateBody } from "@/middlewares/validate.middleware";
import { UserModel } from "@/database/models/user.model";
import { RefreshTokenModel } from "@/database/models/refresh-token.model";
import { AuditAction } from "@/modules/audit/domain/audit-actions";
import { auditService } from "@/modules/shared/application/audit.service";
import { clientIp } from "@/utils/audit-request";

const router = Router();
const service = new AuthService();

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8) });
const refreshSchema = z.object({ refreshToken: z.string().min(10) });

router.post("/login", validateBody(loginSchema), async (req, res) => {
  const result = await service.login(req.body.email, req.body.password);
  if (!result) {
    const user = await UserModel.findOne({ where: { email: req.body.email } });
    if (user) {
      await auditService.log({
        organizationId: user.organizationId,
        userId: user.id,
        action: AuditAction.AUTH_LOGIN_FAILED,
        entityType: "user",
        entityId: user.id,
        ipAddress: clientIp(req),
        beforeChanges: null,
        afterChanges: { result: "Failed", email: req.body.email },
      });
    }
    return res.fail({
      status: 401,
      code: "INVALID_CREDENTIALS",
      message: "Invalid credentials",
      error: { type: "AuthError" },
    });
  }

  await auditService.log({
    organizationId: result.user.organizationId,
    userId: result.user.id,
    action: AuditAction.AUTH_LOGIN_SUCCESS,
    entityType: "user",
    entityId: result.user.id,
    ipAddress: clientIp(req),
    beforeChanges: null,
    afterChanges: { result: "Success", email: result.user.email },
  });

  return res.success({
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    user: {
      id: result.user.id,
      name: result.user.name,
      email: result.user.email,
      organizationId: result.user.organizationId
    }
  });
});

router.post("/refresh", validateBody(refreshSchema), async (req, res) => {
  const refreshed = await service.refresh(req.body.refreshToken);
  if (!refreshed) {
    return res.fail({
      status: 401,
      code: "INVALID_REFRESH_TOKEN",
      message: "Invalid refresh token",
      error: { type: "AuthError" },
    });
  }
  return res.success(refreshed);
});

router.post("/logout", validateBody(refreshSchema), async (req, res) => {
  const existing = await RefreshTokenModel.findOne({ where: { token: req.body.refreshToken } });
  const user = existing ? await UserModel.findByPk(existing.userId) : null;

  await service.logout(req.body.refreshToken);

  if (user) {
    await auditService.log({
      organizationId: user.organizationId,
      userId: user.id,
      action: AuditAction.AUTH_LOGOUT,
      entityType: "user",
      entityId: user.id,
      ipAddress: clientIp(req),
      beforeChanges: null,
      afterChanges: { result: "Success" },
    });
  }

  return res.success(null, { code: "LOGOUT_SUCCESS", message: "Logout successful" });
});

router.post("/forgot-password", async (_req, res) =>
  res.success({ message: "Reset link sent (mock)" }, { code: "RESET_LINK_SENT", message: "Reset link sent" }),
);
router.post("/reset-password", async (_req, res) =>
  res.success({ message: "Password reset (mock)" }, { code: "PASSWORD_RESET", message: "Password reset" }),
);
router.post("/invite-user", async (_req, res) =>
  res.success({ message: "Invite sent (mock)" }, { code: "INVITE_SENT", message: "Invite sent" }),
);
router.post("/activate-account", async (_req, res) =>
  res.success({ message: "Account activated (mock)" }, { code: "ACCOUNT_ACTIVATED", message: "Account activated" }),
);
router.post("/change-password", async (_req, res) =>
  res.success({ message: "Password changed (mock)" }, { code: "PASSWORD_CHANGED", message: "Password changed" }),
);

export const authRoutes = router;
