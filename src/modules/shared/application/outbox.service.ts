import { env } from "@/config/env";
import {
  OutboxMessageModel,
  OutboxMessageStatus,
} from "@/database/models/outbox-message.model";
import { sequelize } from "@/database/sequelize";
import { logger } from "@/infrastructure/logger/winston";
import { enqueueExtraction } from "@/queue/extraction-queue";
import { createId } from "@/utils/id";
import {
  ExtractionRequestedPayload,
  OutboxEventType,
} from "@/modules/shared/domain/outbox-events";
import { Transaction } from "sequelize";

export async function queueExtractionRequested(
  payload: ExtractionRequestedPayload,
  transaction: Transaction,
): Promise<OutboxMessageModel> {
  return OutboxMessageModel.create(
    {
      id: createId(),
      eventType: OutboxEventType.EXTRACTION_REQUESTED,
      aggregateType: "extraction_job",
      aggregateId: payload.extractionJobId,
      payload,
      status: OutboxMessageStatus.PENDING,
      publishAttempts: 0,
      lastError: null,
      publishedAt: null,
    } as any,
    { transaction },
  );
}

async function publishExtractionRequested(message: OutboxMessageModel): Promise<void> {
  const payload = message.payload as ExtractionRequestedPayload;
  if (!payload?.claimId || !payload?.extractionJobId) {
    throw new Error("Invalid EXTRACTION_REQUESTED outbox payload");
  }
  const result = await enqueueExtraction({
    claimId: payload.claimId,
    extractionJobId: payload.extractionJobId,
  });
  if (!result.enqueued && result.reason === "job_not_found") {
    throw new Error("Extraction job not found for outbox message");
  }
}

async function publishOutboxMessage(message: OutboxMessageModel): Promise<void> {
  switch (message.eventType) {
    case OutboxEventType.EXTRACTION_REQUESTED:
      await publishExtractionRequested(message);
      return;
    default:
      throw new Error(`Unsupported outbox event type: ${message.eventType}`);
  }
}

async function claimPendingMessages(): Promise<OutboxMessageModel[]> {
  return sequelize.transaction(async (transaction) => {
    const pending = await OutboxMessageModel.findAll({
      where: { status: OutboxMessageStatus.PENDING },
      order: [["createdAt", "ASC"]],
      limit: env.OUTBOX_BATCH_SIZE,
      lock: transaction.LOCK.UPDATE,
      skipLocked: true,
      transaction,
    });

    for (const message of pending) {
      await message.update({ status: OutboxMessageStatus.PROCESSING }, { transaction });
    }

    return pending;
  });
}

export async function processOutboxBatch(): Promise<number> {
  const messages = await claimPendingMessages();
  if (messages.length === 0) return 0;

  let published = 0;
  for (const message of messages) {
    try {
      await publishOutboxMessage(message);
      await message.update({
        status: OutboxMessageStatus.PUBLISHED,
        publishedAt: new Date(),
        lastError: null,
      });
      published += 1;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Outbox publish failed";
      const nextAttempts = message.publishAttempts + 1;
      const failed = nextAttempts >= env.OUTBOX_MAX_PUBLISH_ATTEMPTS;

      await message.update({
        publishAttempts: nextAttempts,
        lastError: errorMessage,
        status: failed ? OutboxMessageStatus.FAILED : OutboxMessageStatus.PENDING,
      });

      logger.warn("Outbox message publish failed", {
        outboxMessageId: message.id,
        eventType: message.eventType,
        aggregateId: message.aggregateId,
        publishAttempts: nextAttempts,
        failed,
        error: errorMessage,
      });
    }
  }

  if (published > 0) {
    logger.info("Outbox batch published", { count: published });
  }

  return published;
}

/** Reconcile stuck outbox rows against extraction job state. */
export async function recoverStuckOutboxMessages(): Promise<number> {
  const [, publishedMeta] = await sequelize.query(`
    UPDATE "outbox_messages" AS o
    SET "status" = 'PUBLISHED',
        "publishedAt" = COALESCE(o."publishedAt", NOW()),
        "updatedAt" = NOW()
    FROM "extraction_jobs" AS j
    WHERE o."aggregateId" = j."id"
      AND o."eventType" = 'EXTRACTION_REQUESTED'
      AND o."status" IN ('PENDING', 'PROCESSING')
      AND j."status" IN ('COMPLETED', 'FAILED')
      AND o."deletedAt" IS NULL;
  `);

  const [, resetMeta] = await sequelize.query(`
    UPDATE "outbox_messages" AS o
    SET "status" = 'PENDING',
        "updatedAt" = NOW()
    FROM "extraction_jobs" AS j
    WHERE o."aggregateId" = j."id"
      AND o."eventType" = 'EXTRACTION_REQUESTED'
      AND o."status" = 'PROCESSING'
      AND j."status" IN ('QUEUED', 'PROCESSING')
      AND o."deletedAt" IS NULL;
  `);

  const publishedRows = (publishedMeta as { rowCount?: number })?.rowCount ?? 0;
  const resetRows = (resetMeta as { rowCount?: number })?.rowCount ?? 0;
  const total = publishedRows + resetRows;

  if (total > 0) {
    logger.warn("Recovered stuck outbox messages", {
      publishedCompletedOrFailed: publishedRows,
      resetProcessing: resetRows,
    });
  }
  return total;
}
