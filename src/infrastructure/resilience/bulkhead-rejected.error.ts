export class BulkheadRejectedError extends Error {
  readonly code = "BULKHEAD_REJECTED";

  constructor(
    public readonly bulkheadName: string,
    reason: "queue_full" | "timeout",
  ) {
    super(
      reason === "timeout"
        ? `Bulkhead "${bulkheadName}" acquire timed out`
        : `Bulkhead "${bulkheadName}" queue is full`,
    );
    this.name = "BulkheadRejectedError";
  }
}
