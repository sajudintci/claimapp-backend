import { AuditLogModel } from "@/database/models/audit-log.model";
import { auditLogger } from "@/infrastructure/logger/winston";
import { createId } from "@/utils/id";

export type AuditInput = {
  organizationId: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  beforeChanges?: Record<string, unknown> | null;
  afterChanges?: Record<string, unknown> | null;
  ipAddress: string;
};

export class AuditService {
  async log(input: AuditInput) {
    const id = createId();
    await AuditLogModel.create(({ id, ...input } as any));

    auditLogger.info("Audit event", {
      auditId: id,
      organizationId: input.organizationId,
      userId: input.userId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      ipAddress: input.ipAddress,
      beforeChanges: input.beforeChanges ?? null,
      afterChanges: input.afterChanges ?? null,
    });
  }
}

export const auditService = new AuditService();
