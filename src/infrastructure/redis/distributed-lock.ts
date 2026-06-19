import { randomUUID } from "crypto";
import { env } from "@/config/env";
import { getRedisClient } from "@/infrastructure/redis/redis-client";

const RELEASE_LOCK_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
`;

export type DistributedLockHandle = {
  key: string;
  token: string;
};

function namespacedKey(key: string): string {
  return `${env.DISTRIBUTED_LOCK_KEY_PREFIX}:${key}`;
}

/** Try to acquire a Redis lock (SET NX PX). Returns null if another holder owns the lock. */
export async function acquireDistributedLock(
  key: string,
  ttlMs = env.DISTRIBUTED_LOCK_TTL_MS,
): Promise<DistributedLockHandle | null> {
  const redis = getRedisClient();
  const lockKey = namespacedKey(key);
  const token = randomUUID();
  const acquired = await redis.set(lockKey, token, "PX", ttlMs, "NX");
  if (acquired !== "OK") return null;
  return { key: lockKey, token };
}

/** Release lock only when the token matches (safe owner release). */
export async function releaseDistributedLock(handle: DistributedLockHandle): Promise<void> {
  const redis = getRedisClient();
  await redis.eval(RELEASE_LOCK_SCRIPT, 1, handle.key, handle.token);
}

type WithLockOptions = {
  ttlMs?: number;
  /** When true, return null instead of running fn if lock is held elsewhere. */
  skipIfLocked?: boolean;
};

/**
 * Run fn while holding a distributed lock. Non-leader instances skip when skipIfLocked is true.
 */
export async function withDistributedLock<T>(
  key: string,
  fn: () => Promise<T>,
  options: WithLockOptions = {},
): Promise<T | null> {
  const handle = await acquireDistributedLock(key, options.ttlMs);
  if (!handle) {
    if (options.skipIfLocked) return null;
    throw new Error(`Failed to acquire distributed lock: ${key}`);
  }

  try {
    return await fn();
  } finally {
    await releaseDistributedLock(handle);
  }
}
