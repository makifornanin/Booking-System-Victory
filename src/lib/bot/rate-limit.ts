/**
 * Sliding-window limiter kept in memory. On Vercel each warm instance keeps its
 * own counts, so the limits are per instance: enough to stop a runaway n8n loop
 * or a brute-force attempt, not a global quota.
 */
export function createRateLimiter({ limit, windowMs }: { limit: number; windowMs: number }) {
  const hits = new Map<string, number[]>();

  return {
    take(key: string, now = Date.now()): { ok: true } | { ok: false; retryAfterSeconds: number } {
      const recent = (hits.get(key) ?? []).filter((at) => now - at < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000)) };
      }
      recent.push(now);
      hits.set(key, recent);
      if (hits.size > 5000) {
        for (const [k, times] of hits) if (times.every((at) => now - at >= windowMs)) hits.delete(k);
      }
      return { ok: true };
    },
  };
}

const MINUTE = 60_000;

/** Shared limiters for /api/bot/*. */
export const botLimits = {
  /** Wrong or missing API key, per client IP. */
  failedAuth: createRateLimiter({ limit: 20, windowMs: MINUTE }),
  /** All tool calls for one WhatsApp sender. */
  perPhone: createRateLimiter({ limit: 40, windowMs: MINUTE }),
  /** Booking creation for one WhatsApp sender. */
  bookingsPerPhone: createRateLimiter({ limit: 6, windowMs: MINUTE }),
  /** Everything, per instance. */
  global: createRateLimiter({ limit: 600, windowMs: MINUTE }),
};
