export class CircuitBreakerOpenError extends Error {
  readonly code = "CIRCUIT_BREAKER_OPEN";

  constructor(
    public readonly breakerName: string,
    public readonly retryAfterMs: number,
  ) {
    super(
      `Circuit breaker "${breakerName}" is OPEN. Retry after ${Math.max(0, retryAfterMs)}ms`,
    );
    this.name = "CircuitBreakerOpenError";
  }
}
