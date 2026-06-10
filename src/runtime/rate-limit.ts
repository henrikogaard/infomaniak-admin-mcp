export interface RateLimitOptions {
  capacity: number;
  windowMs: number;
}

export class RateLimiter {
  private readonly capacity: number;
  private readonly windowMs: number;
  private readonly timestamps: number[] = [];
  private readonly waiters: Array<() => void> = [];

  constructor(options: RateLimitOptions) {
    if (options.capacity < 1) {
      throw new Error("RateLimiter capacity must be >= 1");
    }
    if (options.windowMs < 1) {
      throw new Error("RateLimiter windowMs must be >= 1");
    }
    this.capacity = options.capacity;
    this.windowMs = options.windowMs;
  }

  public async acquire(): Promise<void> {
    this.purge();
    if (this.timestamps.length < this.capacity) {
      this.timestamps.push(Date.now());
      return;
    }

    return new Promise<void>((resolve) => {
      const tryAgain = (): void => {
        this.purge();
        if (this.timestamps.length < this.capacity) {
          this.timestamps.push(Date.now());
          resolve();
          return;
        }
        const oldest = this.timestamps[0] ?? Date.now();
        const waitMs = Math.max(50, oldest + this.windowMs - Date.now() + 10);
        setTimeout(tryAgain, waitMs);
      };
      this.waiters.push(tryAgain);
      tryAgain();
    });
  }

  public available(): number {
    this.purge();
    return Math.max(0, this.capacity - this.timestamps.length);
  }

  private purge(): void {
    const cutoff = Date.now() - this.windowMs;
    while (this.timestamps.length > 0 && this.timestamps[0]! < cutoff) {
      this.timestamps.shift();
    }
  }
}

export function createInfomaniakRateLimiter(capacity = 60): RateLimiter {
  return new RateLimiter({ capacity, windowMs: 60_000 });
}
