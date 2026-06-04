import { Router } from "express";
import { authRoutes } from "@/modules/auth/presentation/auth.routes";
import { organizationsRoutes } from "@/modules/organizations/presentation/organizations.routes";
import { usersRoutes } from "@/modules/identity-access/presentation/users.routes";
import { claimsRoutes } from "@/modules/claims/presentation/claims.routes";
import { auditRoutes } from "@/modules/audit/presentation/audit.routes";
import { reportsRoutes } from "@/modules/reports/presentation/reports.routes";
import { extractionRoutes } from "@/modules/extraction/presentation/extraction.routes";
import { departmentsRoutes } from "@/modules/departments/presentation/departments.routes";
import { notificationsRoutes } from "@/modules/notifications/presentation/notifications.routes";
import { settingsRoutes } from "@/modules/organizations/presentation/settings.routes";

export const apiRouter = Router();

apiRouter.use("/auth", authRoutes);
apiRouter.use("/organizations", organizationsRoutes);
apiRouter.use("/users", usersRoutes);
apiRouter.use("/claims", claimsRoutes);
apiRouter.use("/audit-logs", auditRoutes);
apiRouter.use("/reports", reportsRoutes);
apiRouter.use("/extraction", extractionRoutes);
apiRouter.use("/departments", departmentsRoutes);
apiRouter.use("/notifications", notificationsRoutes);
apiRouter.use("/settings", settingsRoutes);
