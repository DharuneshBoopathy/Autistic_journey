/**
 * Derivative-generation worker (`npm run worker`).
 *
 * Runs as a separate process so a slow or memory-hungry resize never occupies a
 * request handler. This is the right shape and the default one; `WORKER_IN_PROCESS`
 * exists for hosting that will not run a second process, and trades exactly that
 * isolation away.
 *
 * The loop itself lives in `./loop`, shared with the in-process variant so the two
 * cannot drift. The work lives in `./process`, which tests drive directly.
 */
import { client } from '@/db';
import { runWorkerLoop } from './loop';

async function main() {
  console.warn('[worker] started');

  const controller = new AbortController();
  const stop = () => {
    console.warn('[worker] shutting down after the current batch');
    controller.abort();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  await runWorkerLoop({ signal: controller.signal });
  await client.end();
}

main().catch((error: unknown) => {
  console.error('[worker] fatal', error);
  process.exit(1);
});
