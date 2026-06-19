import { env } from "@/config/env";
import { Bulkhead, BulkheadStats } from "@/infrastructure/resilience/bulkhead";

function createBulkhead(
  name: string,
  maxConcurrent: number,
  maxWaiting: number,
  acquireTimeoutMs: number,
): Bulkhead {
  return new Bulkhead(name, {
    maxConcurrent,
    maxWaiting,
    acquireTimeoutMs,
    enabled: env.BULKHEAD_ENABLED,
  });
}

/** Isolates concurrent ABBYY Vantage OCR calls. */
export const abbyyBulkhead = createBulkhead(
  "abbyy",
  env.BULKHEAD_ABBYY_MAX_CONCURRENT,
  env.BULKHEAD_ABBYY_MAX_WAITING,
  env.BULKHEAD_ABBYY_ACQUIRE_TIMEOUT_MS,
);

/** Isolates concurrent OpenAI / LLM HTTP calls. */
export const openaiBulkhead = createBulkhead(
  "openai",
  env.BULKHEAD_OPENAI_MAX_CONCURRENT,
  env.BULKHEAD_OPENAI_MAX_WAITING,
  env.BULKHEAD_OPENAI_ACQUIRE_TIMEOUT_MS,
);

export function getBulkheadStats(): Record<string, BulkheadStats> {
  return {
    abbyy: abbyyBulkhead.getStats(),
    openai: openaiBulkhead.getStats(),
  };
}
