import { sleep } from '../../utils/sleep';
import { logger } from '../../utils/logger';

interface TokenBucket {
  tokens: number;
  lastRefill: number;
  refillRatePerMs: number;
  capacity: number;
}

export class RateLimiter {
  private buckets: Map<number, TokenBucket> = new Map();

  constructor() {
    // Tier 2 (search.messages): 15 req/min (보수적)
    this.buckets.set(2, { tokens: 3, lastRefill: Date.now(), refillRatePerMs: 15 / 60000, capacity: 3 });
    // Tier 3 (conversations.replies): 40 req/min
    this.buckets.set(3, { tokens: 10, lastRefill: Date.now(), refillRatePerMs: 40 / 60000, capacity: 10 });
    // Tier 4 (users.info, auth.test): 80 req/min
    this.buckets.set(4, { tokens: 10, lastRefill: Date.now(), refillRatePerMs: 80 / 60000, capacity: 10 });
  }

  async execute<T>(tier: 2 | 3 | 4, fn: () => Promise<T>, maxRetries = 5): Promise<T> {
    await this.waitForToken(tier);

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        const isRateLimited =
          err?.code === 'slack_webapi_rate_limited' ||
          err?.data?.error === 'ratelimited';

        if (isRateLimited) {
          const retryAfterSec = err?.retryAfter ?? err?.data?.retry_after ?? 60;
          const waitMs = retryAfterSec * 1000 + Math.floor(Math.random() * 2000);
          logger.warn({ tier, attempt, waitMs }, 'Slack 429 - waiting');
          await sleep(waitMs);
          await this.waitForToken(tier);
          continue;
        }
        throw err;
      }
    }
    throw new Error(`RateLimiter: max retries (${maxRetries}) exceeded for tier ${tier}`);
  }

  private async waitForToken(tier: 2 | 3 | 4): Promise<void> {
    const bucket = this.buckets.get(tier)!;
    const now = Date.now();
    const elapsed = now - bucket.lastRefill;
    bucket.tokens = Math.min(bucket.capacity, bucket.tokens + elapsed * bucket.refillRatePerMs);
    bucket.lastRefill = now;

    if (bucket.tokens < 1) {
      const waitMs = Math.ceil((1 - bucket.tokens) / bucket.refillRatePerMs);
      logger.debug({ tier, waitMs }, 'Rate limit: waiting for token');
      await sleep(waitMs);
      bucket.tokens = 0;
    } else {
      bucket.tokens -= 1;
    }
  }
}
