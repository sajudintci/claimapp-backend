import Redis from "ioredis";
import { env } from "@/config/env";

let sharedClient: Redis | null = null;

function createRedisClient(): Redis {
  if (env.REDIS_URL) {
    return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  }

  return new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    username: env.REDIS_USERNAME,
    password: env.REDIS_PASSWORD,
    db: env.REDIS_DB,
    maxRetriesPerRequest: null,
  });
}

/** Shared ioredis client for distributed locks (separate from BullMQ connections). */
export function getRedisClient(): Redis {
  if (!sharedClient) {
    sharedClient = createRedisClient();
  }
  return sharedClient;
}

export async function closeRedisClient(): Promise<void> {
  if (!sharedClient) return;
  await sharedClient.quit();
  sharedClient = null;
}
