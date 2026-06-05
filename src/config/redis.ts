import type { ConnectionOptions } from "bullmq";
import { env } from "@/config/env";

function connectionFromRedisUrl(url: string): ConnectionOptions {
  const parsed = new URL(url);
  const db =
    parsed.pathname && parsed.pathname !== "/"
      ? Number(parsed.pathname.replace(/^\//, ""))
      : 0;

  const connection: ConnectionOptions = {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
  };

  if (parsed.username) {
    connection.username = decodeURIComponent(parsed.username);
  }
  if (parsed.password) {
    connection.password = decodeURIComponent(parsed.password);
  }
  if (!Number.isNaN(db) && db > 0) {
    connection.db = db;
  }

  return connection;
}

/** BullMQ / ioredis connection (URL or host+port+auth). */
export function getRedisConnection(): ConnectionOptions {
  if (env.REDIS_URL) {
    return connectionFromRedisUrl(env.REDIS_URL);
  }

  const connection: ConnectionOptions = {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
  };

  if (env.REDIS_USERNAME) {
    connection.username = env.REDIS_USERNAME;
  }
  if (env.REDIS_PASSWORD) {
    connection.password = env.REDIS_PASSWORD;
  }
  if (env.REDIS_DB != null && env.REDIS_DB > 0) {
    connection.db = env.REDIS_DB;
  }

  return connection;
}
