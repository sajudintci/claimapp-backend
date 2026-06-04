import { AuditLogModel } from "@/database/models/audit-log.model";
import { UserModel } from "@/database/models/user.model";
import type { AuditResult } from "@/modules/audit/domain/audit-actions";
import {
  normalizeAuditChanges,
} from "@/modules/audit/application/audit-display";

export type AuditLogDto = {
  id: string;
  organizationId: string;
  userId: string;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  ipAddress: string;
  result: AuditResult;
  beforeChanges: Record<string, unknown> | null;
  afterChanges: Record<string, unknown> | null;
};

function resolveResult(afterChanges: Record<string, unknown> | null): AuditResult {
  const raw = afterChanges?.result;
  if (raw === "Failed" || raw === "Warning" || raw === "Success") return raw;
  return "Success";
}

export function mapAuditLogRow(row: AuditLogModel): AuditLogDto {
  const user = row.get("user") as UserModel | undefined;
  const before = normalizeAuditChanges(row.beforeChanges);
  const after = normalizeAuditChanges(row.afterChanges);

  return {
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    actorName: user?.name ?? null,
    actorEmail: user?.email ?? null,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    createdAt: row.createdAt.toISOString(),
    ipAddress: row.ipAddress,
    result: resolveResult(after),
    beforeChanges: before,
    afterChanges: after,
  };
}

export function formatActionLabel(action: string): string {
  return action
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
