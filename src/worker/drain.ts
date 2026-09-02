/**
 * Process the queue until it is empty, then exit (`npm run worker:drain`).
 *
 * Useful for backfills, for a one-shot run after a bulk import, and for tests that
 * need derivatives to exist without racing a long-running worker.
 */
import { client } from '@/db';
import { drainQueue } from './process';

drainQueue()
  .then((processed) => {
    console.warn(`[drain] processed ${processed} job(s)`);
  })
  .catch((error: unknown) => {
    console.error('[drain] failed', error);
    process.exitCode = 1;
  })
  .finally(() => client.end());
