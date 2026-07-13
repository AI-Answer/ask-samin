interface RateBucket {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

const MAX_BUCKETS = 5_000;
const buckets = new Map<string, RateBucket>();

/**
 * Bounded single-process fallback. A multi-instance deployment should replace
 * this with a shared Redis/KV limiter at the platform edge.
 */
export function consumeRateLimit(
  namespace: string,
  identity: string,
  limit: number,
  windowMs = 60_000
): RateLimitResult {
  const now = Date.now();
  const key = `${namespace}:${identity}`;
  let bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
  }
  bucket.count += 1;
  buckets.delete(key);
  buckets.set(key, bucket);

  if (buckets.size > MAX_BUCKETS) {
    for (const [candidateKey, candidate] of buckets) {
      if (candidate.resetAt <= now || buckets.size > MAX_BUCKETS) buckets.delete(candidateKey);
      if (buckets.size <= MAX_BUCKETS) break;
    }
  }

  return {
    allowed: bucket.count <= limit,
    limit,
    remaining: Math.max(0, limit - bucket.count),
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000))
  };
}
