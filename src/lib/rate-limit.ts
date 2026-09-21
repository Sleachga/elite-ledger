/**
 * Tiny fixed-window, in-memory rate limiter. Best effort only: each server
 * instance keeps its own counts and a cold start forgets them. Good enough to
 * stop one client from looping; not a security boundary.
 */
export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until the window resets (0 when allowed). */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  take(key: string, now?: number): RateLimitDecision;
  reset(): void;
}

export function createRateLimiter(options: { limit: number; windowMs: number }): RateLimiter {
  const { limit, windowMs } = options;
  const windows = new Map<string, { startedAt: number; count: number }>();

  return {
    take(key, now = Date.now()) {
      // Drop expired windows so the map cannot grow without bound.
      if (windows.size > 1000) {
        for (const [entryKey, entry] of windows) {
          if (now - entry.startedAt >= windowMs) windows.delete(entryKey);
        }
      }

      const current = windows.get(key);
      if (!current || now - current.startedAt >= windowMs) {
        windows.set(key, { startedAt: now, count: 1 });
        return { allowed: true, retryAfterSeconds: 0 };
      }
      if (current.count < limit) {
        current.count += 1;
        return { allowed: true, retryAfterSeconds: 0 };
      }
      const retryAfterSeconds = Math.max(1, Math.ceil((current.startedAt + windowMs - now) / 1000));
      return { allowed: false, retryAfterSeconds };
    },
    reset() {
      windows.clear();
    },
  };
}
