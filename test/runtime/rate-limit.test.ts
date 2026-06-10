import { describe, expect, it, vi } from "vitest";

import { RateLimiter } from "../../src/runtime/rate-limit.js";

describe("RateLimiter", () => {
  it("rejects invalid configuration", () => {
    expect(() => new RateLimiter({ capacity: 0, windowMs: 60_000 })).toThrow();
    expect(() => new RateLimiter({ capacity: 60, windowMs: 0 })).toThrow();
  });

  it("acquires immediately while under capacity", async () => {
    const rateLimiter = new RateLimiter({ capacity: 3, windowMs: 60_000 });
    const start = Date.now();
    await rateLimiter.acquire();
    await rateLimiter.acquire();
    await rateLimiter.acquire();
    expect(Date.now() - start).toBeLessThan(50);
    expect(rateLimiter.available()).toBe(0);
  });

  it("queues additional requests once the bucket is full", async () => {
    vi.useFakeTimers();
    const rateLimiter = new RateLimiter({ capacity: 2, windowMs: 1_000 });
    await rateLimiter.acquire();
    await rateLimiter.acquire();
    expect(rateLimiter.available()).toBe(0);

    let resolved = false;
    const queued = rateLimiter.acquire().then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1_100);
    await queued;
    expect(resolved).toBe(true);

    vi.useRealTimers();
  });

  it("reports available tokens after timestamps expire", async () => {
    vi.useFakeTimers();
    const rateLimiter = new RateLimiter({ capacity: 2, windowMs: 1_000 });
    await rateLimiter.acquire();
    expect(rateLimiter.available()).toBe(1);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(rateLimiter.available()).toBe(2);
    vi.useRealTimers();
  });
});
