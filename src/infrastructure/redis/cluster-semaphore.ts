import { env } from "@/config/env";
import { getRedisClient } from "@/infrastructure/redis/redis-client";
import { BulkheadRejectedError } from "@/infrastructure/resilience/bulkhead-rejected.error";

const ACQUIRE_SCRIPT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local current = tonumber(redis.call('get', key) or '0')
if current < limit then
  redis.call('incr', key)
  redis.call('pexpire', key, ttl)
  return 1
end
return 0
`;

const RELEASE_SCRIPT = `
local key = KEYS[1]
local current = tonumber(redis.call('get', key) or '0')
if current > 0 then
  return redis.call('decr', key)
end
return 0
`;

function semaphoreKey(name: string): string {
  return `${env.CLUSTER_BULKHEAD_KEY_PREFIX}:${name}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Cluster-wide counting semaphore backed by Redis (safe across API/worker replicas). */
export async function withClusterSemaphore<T>(
  name: string,
  maxConcurrent: number,
  acquireTimeoutMs: number,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  if (!env.CLUSTER_BULKHEAD_ENABLED) {
    return fn();
  }

  const redis = getRedisClient();
  const key = semaphoreKey(name);
  const deadline = Date.now() + acquireTimeoutMs;
  let acquired = false;

  while (Date.now() < deadline) {
    const ok = (await redis.eval(
      ACQUIRE_SCRIPT,
      1,
      key,
      String(maxConcurrent),
      String(ttlMs),
    )) as number;
    if (ok === 1) {
      acquired = true;
      break;
    }
    await sleep(50);
  }

  if (!acquired) {
    throw new BulkheadRejectedError(name, "timeout");
  }

  try {
    return await fn();
  } finally {
    await redis.eval(RELEASE_SCRIPT, 1, key);
  }
}
