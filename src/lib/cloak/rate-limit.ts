/*
 * A fixed-window rate-limit bucket store that does not grow without bound.
 *
 * Dependency-free, so `src/proxy.ts` (edge runtime) and the node-side routes
 * can share one implementation.
 *
 * WHY THIS EXISTS. The hand-rolled limiters this replaces kept a `Map` and only
 * ever touched the key they were asked about, so an entry was never removed —
 * not even after it expired. The map therefore retained one row per distinct
 * key for the lifetime of the process. On a long-lived server that is a slow
 * leak from ordinary traffic and a fast one from a distributed scan; the
 * middleware's own limiter had a sweep, but the two route-level ones did not.
 *
 * The sweep is time- and size-triggered rather than per-call so the common path
 * stays O(1): it runs at most once per interval, and immediately if the map
 * exceeds its cap. If a sweep cannot get the map under the cap — a burst with
 * far more live keys than expected — the oldest entries are evicted, because a
 * bounded amount of lost counting is preferable to unbounded memory. Insertion
 * order is Map iteration order, so "oldest" is exact.
 *
 * This is a fixed window, not a sliding one: a caller can burst up to `max`
 * either side of a boundary. That is the same trade-off the limiters it
 * replaces already made, and it is fine for abuse control.
 */

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export class RateLimitBuckets {
  private readonly buckets = new Map<string, Bucket>();
  private lastSweepAt = 0;

  constructor(
    private readonly maxEntries = 20_000,
    private readonly sweepIntervalMs = 30_000
  ) {}

  /** Current number of live buckets — for tests and diagnostics. */
  get size(): number {
    return this.buckets.size;
  }

  /**
   * Counts one attempt against `key` and reports whether it is within `max`
   * for the current `windowMs`.
   */
  take(key: string, max: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    this.sweep(now);

    const entry = this.buckets.get(key);
    if (!entry || entry.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, retryAfterSec: 0 };
    }

    entry.count += 1;
    if (entry.count > max) {
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
    }
    return { allowed: true, retryAfterSec: 0 };
  }

  /** Drops a key entirely — e.g. after a successful login. */
  forget(key: string): void {
    this.buckets.delete(key);
  }

  private sweep(now: number): void {
    const overdue = this.buckets.size > this.maxEntries;
    if (!overdue && now - this.lastSweepAt < this.sweepIntervalMs) return;
    this.lastSweepAt = now;

    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }

    /* Still oversized: evict oldest-inserted until under the cap. */
    if (this.buckets.size > this.maxEntries) {
      const excess = this.buckets.size - this.maxEntries;
      let removed = 0;
      for (const key of this.buckets.keys()) {
        if (removed >= excess) break;
        this.buckets.delete(key);
        removed += 1;
      }
    }
  }
}
