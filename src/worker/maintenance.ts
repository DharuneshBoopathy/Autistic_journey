import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { pruneRateLimits } from '@/lib/rate-limit';
import { requeueStalled } from './process';
import { purgeExpired } from './purge';

/**
 * Drop sessions that expired or were revoked long enough ago to be of no forensic
 * use.
 *
 * The query lives here rather than in `src/lib/session.ts` because that module
 * carries `import 'server-only'` — correct, since it reads cookies and must never
 * reach the browser — and that guard throws outside Next's runtime, which would take
 * this worker down at startup.
 */
async function pruneSessions(): Promise<void> {
  await db.execute(sql`
    DELETE FROM sessions
     WHERE expires_at < now() - interval '7 days'
        OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '7 days')
  `);
}

/**
 * Periodic housekeeping, run from the worker loop.
 *
 * Deliberately part of the existing worker rather than a third process or a cron
 * entry: a deployment of two long-running processes is one someone can actually keep
 * running, and none of this is time-critical enough to justify more moving parts.
 *
 * Every step is independent and failure-isolated — a storage outage that stops the
 * purge must not also stop expired sessions being cleaned up.
 */
export async function runMaintenance(): Promise<void> {
  const steps: Array<[string, () => Promise<unknown>]> = [
    ['sessions', pruneSessions],
    ['rate limits', pruneRateLimits],
    ['stalled jobs', requeueStalled],
    ['purge', purgeExpired],
  ];

  for (const [name, run] of steps) {
    try {
      const result = await run();
      if (name === 'purge') {
        const { purged, failed } = result as { purged: number; failed: number };
        if (purged > 0 || failed > 0) {
          console.warn(`[maintenance] purged ${purged} photo(s), ${failed} failed`);
        }
      }
    } catch (error) {
      console.error(`[maintenance] ${name} failed:`, error instanceof Error ? error.message : error);
    }
  }
}
