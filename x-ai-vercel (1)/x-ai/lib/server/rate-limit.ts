import "server-only";

import { getInfraConfig } from "./config";

/**
 * Best-effort in-memory rate limiter.
 *
 * This is intentionally simple: it protects a single Node process (a VPS, a
 * self-hosted deployment, or one warm serverless instance). It is NOT a
 * distributed limiter — serverless platforms run many isolated instances, so
 * it must be paired with platform-level protection (Vercel WAF / Firewall,
 * a reverse proxy like nginx or Caddy, or Cloudflare) for real abuse control.
 * This limitation is documented in the README.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let lastSweep = 0;

function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function clientKeyFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip") ?? headers.get("cf-connecting-ip") ?? "unknown";
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

/** Sliding-window-per-IP counter with a fixed window per bucket key. */
export function checkRateLimit(scope: string, clientKey: string, limit: number): RateLimitResult {
  const cfg = getInfraConfig();
  if (!cfg.rateLimitEnabled || limit <= 0) {
    return { allowed: true, limit: 0, remaining: limit, retryAfterSeconds: 0 };
  }
  const now = Date.now();
  sweep(now);
  const key = `${scope}:${clientKey}`;
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + cfg.rateLimitWindowMs });
    return { allowed: true, limit, remaining: limit - 1, retryAfterSeconds: 0 };
  }
  existing.count += 1;
  const remaining = Math.max(0, limit - existing.count);
  return {
    allowed: existing.count <= limit,
    limit,
    remaining,
    retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
  };
}

export function rateLimits() {
  const cfg = getInfraConfig();
  return {
    chat: cfg.rateLimitChat,
    image: cfg.rateLimitImage,
    read: cfg.rateLimitRead,
  };
}
