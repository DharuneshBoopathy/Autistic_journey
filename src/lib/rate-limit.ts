import { sql } from 'drizzle-orm';
import { db } from '@/db';

/**
 * Fixed-window rate limiting, backed by Postgres.
 *
 * Deliberately not Redis: this archive serves one college batch, so the request
 * volume never justifies another piece of infrastructure to run, secure and back
 * up. It is also correct across multiple app instances, which an in-memory counter
 * would not be — and an in-memory limiter on a serverless platform is barely a
 * limiter at all, since each cold start resets it.
 *
 * The whole check is a single atomic UPSERT. Two concurrent requests cannot both
 * read "0 so far" and both proceed, because the increment happens inside the same
 * statement that decides.
 */

export type RateLimitRule = {
  /** Requests permitted per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

/**
 * Tuned to be strict where the cost of abuse is account compromise, and loose where
 * it is merely load.
 */
export const RateLimits = {
  /** Per address. Slows credential stuffing without locking out a fat-fingered user. */
  LOGIN_PER_EMAIL: { limit: 5, windowSeconds: 900 },
  /** Per client. Catches an attacker spraying one password across many addresses. */
  LOGIN_PER_IP: { limit: 20, windowSeconds: 900 },
  /** Invite redemption is the gate to the whole archive; brute-forcing it must be futile. */
  INVITE_REDEEM_PER_IP: { limit: 10, windowSeconds: 3600 },
  REGISTER_PER_IP: { limit: 5, windowSeconds: 3600 },
  UPLOAD_PER_USER: { limit: 2000, windowSeconds: 3600 },
  SEARCH_PER_USER: { limit: 300, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>;

/**
 * Consume one unit against `key`. Returns whether the caller may proceed.
 *
 * Fails **open** on a database error, and says so loudly. A limiter that fails
 * closed would turn a transient database blip into a total lockout of the archive;
 * the authentication checks behind it are the real control, and they are unaffected.
 */
export async function consumeRateLimit(
  key: string,
  rule: RateLimitRule,
): Promise<RateLimitResult> {
  try {
    const rows = await db.execute<{ count: number; window_start: Date }>(sql`
      INSERT INTO rate_limits (key, count, window_start)
      VALUES (${key}, 1, now())
      ON CONFLICT (key) DO UPDATE
        SET count = CASE
              WHEN rate_limits.window_start < now() - make_interval(secs => ${rule.windowSeconds})
              THEN 1
              ELSE rate_limits.count + 1
            END,
            window_start = CASE
              WHEN rate_limits.window_start < now() - make_interval(secs => ${rule.windowSeconds})
              THEN now()
              ELSE rate_limits.window_start
            END
      RETURNING count, window_start
    `);

    const row = rows[0];
    if (!row) return { allowed: true, remaining: rule.limit - 1, retryAfterSeconds: 0 };

    const count = Number(row.count);
    const elapsed = (Date.now() - new Date(row.window_start).getTime()) / 1000;

    return {
      allowed: count <= rule.limit,
      remaining: Math.max(0, rule.limit - count),
      retryAfterSeconds: Math.max(1, Math.ceil(rule.windowSeconds - elapsed)),
    };
  } catch (error) {
    console.error('[rate-limit] check failed, allowing request', key, error);
    return { allowed: true, remaining: 0, retryAfterSeconds: 0 };
  }
}

/** Clear a counter — used after a successful login so one typo does not linger. */
export async function resetRateLimit(key: string): Promise<void> {
  try {
    await db.execute(sql`DELETE FROM rate_limits WHERE key = ${key}`);
  } catch (error) {
    console.error('[rate-limit] reset failed', key, error);
  }
}

/** Housekeeping: drop counters whose window closed long ago. */
export async function pruneRateLimits(): Promise<void> {
  await db.execute(sql`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`);
}
