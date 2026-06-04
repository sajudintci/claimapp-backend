import type { Request } from "express";
import { auditService } from "@/modules/shared/application/audit.service";
import type { AuditResult } from "@/modules/audit/domain/audit-actions";

export function clientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0]?.trim() ?? req.ip ?? "";
  }
  return req.ip ?? "";
}

export type WriteAuditParams = {
  organizationId?: string;
  userId?: string;
  action: string;
  entityType: string;
  entityId: string;
  beforeChanges?: Record<string, unknown> | null;
  afterChanges?: Record<string, unknown> | null;
  ipAddress?: string;
  result?: AuditResult;
};

function withResult(
  afterChanges: Record<string, unknown> | null | undefined,
  result: AuditResult,
): Record<string, unknown> {
  return { ...(afterChanges ?? {}), result };
}

export async function writeAuditFromRequest(
  req: Request,
  params: WriteAuditParams,
): Promise<void> {
  const organizationId = params.organizationId ?? req.auth?.org;
  const userId = params.userId ?? req.auth?.sub;
  if (!organizationId || !userId) return;

  try {
    const { result = "Success", ...rest } = params;
    await auditService.log({
      organizationId,
      userId,
      action: rest.action,
      entityType: rest.entityType,
      entityId: rest.entityId,
      beforeChanges: rest.beforeChanges ?? null,
      ipAddress: clientIp(req),
      afterChanges: withResult(rest.afterChanges, result),
    });
  } catch {
    // Audit must not break primary flows
  }
}

export async function writeSystemAudit(params: WriteAuditParams): Promise<void> {
  if (!params.organizationId || !params.userId) return;
  try {
    const { result = "Success", ...rest } = params;
    await auditService.log({
      organizationId: params.organizationId,
      userId: params.userId,
      action: rest.action,
      entityType: rest.entityType,
      entityId: rest.entityId,
      beforeChanges: rest.beforeChanges ?? null,
      ipAddress: rest.ipAddress ?? "system",
      afterChanges: withResult(rest.afterChanges, result),
    });
  } catch {
    // ignore
  }
}
