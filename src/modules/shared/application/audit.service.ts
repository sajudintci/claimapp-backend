import { AuditLogModel } from "@/database/models/audit-log.model";
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
    await AuditLogModel.create(({ id: createId(), ...input } as any));
  }
}

export const auditService = new AuditService();
