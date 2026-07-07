import type { Transaction } from "sequelize";
import { NotificationModel } from "@/database/models/notification.model";
import type { NotificationContent } from "@/modules/notifications/application/notification-events";
import { createId } from "@/utils/id";
import { logger } from "@/infrastructure/logger/winston";

export async function createOrganizationNotification(
  params: {
    organizationId: string;
  } & NotificationContent,
  options?: { transaction?: Transaction },
): Promise<void> {
  try {
    await NotificationModel.create(
      {
        id: createId(),
        organizationId: params.organizationId,
        type: params.type,
        title: params.title,
        message: params.message,
        isRead: false,
      } as any,
      options?.transaction ? { transaction: options.transaction } : undefined,
    );
  } catch (err) {
    logger.warn("Failed to create organization notification", {
      organizationId: params.organizationId,
      title: params.title,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
