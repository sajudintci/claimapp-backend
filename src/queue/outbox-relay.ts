import { env } from "@/config/env";
import { withDistributedLock } from "@/infrastructure/redis/distributed-lock";
import { logger } from "@/infrastructure/logger/winston";
import {
  processOutboxBatch,
  recoverStuckOutboxMessages,
} from "@/modules/shared/application/outbox.service";
import { DistributedLockKey } from "@/modules/shared/domain/distributed-lock-keys";

let pollTimer: ReturnType<typeof setInterval> | null = null;

async function runRelayCycle() {
  await withDistributedLock(
    DistributedLockKey.OUTBOX_RELAY,
    async () => processOutboxBatch(),
    { skipIfLocked: true, ttlMs: env.DISTRIBUTED_LOCK_TTL_MS },
  );
}

export async function initOutboxRelay() {
  await withDistributedLock(
    DistributedLockKey.OUTBOX_RECOVER,
    recoverStuckOutboxMessages,
    { skipIfLocked: true, ttlMs: env.DISTRIBUTED_LOCK_TTL_MS },
  );

  await runRelayCycle();
  pollTimer = setInterval(() => {
    void runRelayCycle();
  }, env.OUTBOX_POLL_INTERVAL_MS);

  logger.info("Outbox relay initialized", {
    pollIntervalMs: env.OUTBOX_POLL_INTERVAL_MS,
    batchSize: env.OUTBOX_BATCH_SIZE,
    distributedLockTtlMs: env.DISTRIBUTED_LOCK_TTL_MS,
  });
}

export function stopOutboxRelay() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
