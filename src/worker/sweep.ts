/**
 * Run housekeeping once and exit (`npm run worker:sweep`).
 *
 * The long-running worker does this on a timer; this exists for deployments that
 * prefer an external scheduler, and for verifying the purge by hand.
 */
import { client } from '@/db';
import { runMaintenance } from './maintenance';

runMaintenance()
  .then(() => console.warn('[sweep] done'))
  .catch((error: unknown) => {
    console.error('[sweep] failed', error);
    process.exitCode = 1;
  })
  .finally(() => client.end());
