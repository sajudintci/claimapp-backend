import { logger } from "@/infrastructure/logger/winston";
import { BulkheadRejectedError } from "@/infrastructure/resilience/bulkhead-rejected.error";

export type BulkheadOptions = {
  maxConcurrent: number;
  maxWaiting: number;
  acquireTimeoutMs: number;
  enabled: boolean;
};

export type BulkheadStats = {
  name: string;
  maxConcurrent: number;
  maxWaiting: number;
  active: number;
  waiting: number;
  available: number;
};

type Waiter = {
  grant: () => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class Bulkhead {
  private active = 0;
  private readonly waiters: Waiter[] = [];

  constructor(
    public readonly name: string,
    private readonly options: BulkheadOptions,
  ) {}

  getStats(): BulkheadStats {
    return {
      name: this.name,
      maxConcurrent: this.options.maxConcurrent,
      maxWaiting: this.options.maxWaiting,
      active: this.active,
      waiting: this.waiters.length,
      available: Math.max(0, this.options.maxConcurrent - this.active),
    };
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.options.enabled) {
      return fn();
    }

    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.options.maxConcurrent) {
      this.active += 1;
      return Promise.resolve();
    }

    if (this.waiters.length >= this.options.maxWaiting) {
      logger.warn("Bulkhead queue full", {
        bulkhead: this.name,
        maxWaiting: this.options.maxWaiting,
      });
      return Promise.reject(new BulkheadRejectedError(this.name, "queue_full"));
    }

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((waiter) => waiter.grant === grant);
        if (index >= 0) {
          this.waiters.splice(index, 1);
        }
        reject(new BulkheadRejectedError(this.name, "timeout"));
      }, this.options.acquireTimeoutMs);

      const grant = () => {
        clearTimeout(timer);
        resolve();
      };

      this.waiters.push({ grant, reject, timer });
    });
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      clearTimeout(next.timer);
      next.grant();
      return;
    }

    this.active = Math.max(0, this.active - 1);
  }
}
