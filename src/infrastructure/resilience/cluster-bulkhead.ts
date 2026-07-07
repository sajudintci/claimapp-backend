import { Bulkhead } from "@/infrastructure/resilience/bulkhead";
import { withClusterSemaphore } from "@/infrastructure/redis/cluster-semaphore";

type ClusterBulkheadOptions = {
  acquireTimeoutMs: number;
  clusterTtlMs: number;
};

/**
 * Per-process bulkhead plus optional Redis cluster semaphore (limits across replicas).
 */
export async function runWithBulkhead<T>(
  bulkhead: Bulkhead,
  options: ClusterBulkheadOptions,
  fn: () => Promise<T>,
): Promise<T> {
  return bulkhead.run(() =>
    withClusterSemaphore(
      bulkhead.name,
      bulkhead.getStats().maxConcurrent,
      options.acquireTimeoutMs,
      options.clusterTtlMs,
      fn,
    ),
  );
}
