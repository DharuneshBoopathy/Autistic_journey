/**
 * Derivative-generation worker (`npm run worker`).
 *
 * Runs as a separate process so a slow or memory-hungry resize never occupies a
 * request handler. Several instances may run concurrently: jobs are claimed with
 * `FOR UPDATE SKIP LOCKED`, so no two workers take the same photo.
 *
 * The work itself lives in `./process`, which tests drive directly.
 */
import { client } from '@/db';
import { requeueStalled, runOnce } from './process';

const IDLE_DELAY_MS = 2_000;

/** Sweep for jobs abandoned by a crashed worker roughly once a minute when idle. */
const PASSES_BETWEEN_SWEEPS = 30;

async function main() {
  console.warn('[worker] started');

  let running = true;
  const stop = () => {
    console.warn('[worker] shutting down after the current batch');
    running = false;
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  let sinceSweep = 0;

  while (running) {
    const processed = await runOnce();

    if (++sinceSweep >= PASSES_BETWEEN_SWEEPS) {
      await requeueStalled();
      sinceSweep = 0;
    }

    // Only pause when there was nothing to do, so a backlog drains at full speed.
    if (processed === 0) {
      await new Promise((resolve) => setTimeout(resolve, IDLE_DELAY_MS));
    }
  }

  await client.end();
  console.warn('[worker] stopped');
}

main().catch((error: unknown) => {
  console.error('[worker] fatal', error);
  process.exit(1);
});
