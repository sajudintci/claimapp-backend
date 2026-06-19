import { logger } from "@/infrastructure/logger/winston";
import { CircuitBreakerOpenError } from "@/infrastructure/resilience/circuit-breaker-open.error";

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export type CircuitBreakerOptions = {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenSuccessThreshold: number;
  enabled: boolean;
};

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private consecutiveFailures = 0;
  private halfOpenSuccesses = 0;
  private openedAtMs = 0;

  constructor(
    public readonly name: string,
    private readonly options: CircuitBreakerOptions,
  ) {}

  getState(): CircuitState {
    return this.state;
  }

  /** Reject fast when OPEN; transition to HALF_OPEN after reset timeout. */
  guard(): void {
    if (!this.options.enabled) return;

    if (this.state !== "OPEN") return;

    const elapsed = Date.now() - this.openedAtMs;
    if (elapsed < this.options.resetTimeoutMs) {
      throw new CircuitBreakerOpenError(
        this.name,
        this.options.resetTimeoutMs - elapsed,
      );
    }

    this.state = "HALF_OPEN";
    this.halfOpenSuccesses = 0;
    logger.info("Circuit breaker half-open", { breaker: this.name });
  }

  recordSuccess(): void {
    if (!this.options.enabled) return;

    this.consecutiveFailures = 0;

    if (this.state === "HALF_OPEN") {
      this.halfOpenSuccesses += 1;
      if (this.halfOpenSuccesses >= this.options.halfOpenSuccessThreshold) {
        this.state = "CLOSED";
        logger.info("Circuit breaker closed", { breaker: this.name });
      }
      return;
    }

    if (this.state !== "CLOSED") {
      this.state = "CLOSED";
      logger.info("Circuit breaker closed", { breaker: this.name });
    }
  }

  recordFailure(): void {
    if (!this.options.enabled) return;

    this.consecutiveFailures += 1;
    this.halfOpenSuccesses = 0;

    const shouldOpen =
      this.state === "HALF_OPEN" ||
      this.consecutiveFailures >= this.options.failureThreshold;

    if (!shouldOpen) return;

    this.state = "OPEN";
    this.openedAtMs = Date.now();
    logger.warn("Circuit breaker opened", {
      breaker: this.name,
      consecutiveFailures: this.consecutiveFailures,
      resetTimeoutMs: this.options.resetTimeoutMs,
    });
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.guard();
    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (err) {
      if (!(err instanceof CircuitBreakerOpenError)) {
        this.recordFailure();
      }
      throw err;
    }
  }
}
