import { runMaintenance } from './maintenance';
import { runOnce } from './process';

/**
 * The worker's main loop, extracted so it has exactly one implementation.
 *
 * It is run two ways: as its own process (`worker/index.ts`), which is the right
 * shape and the default; and inside the web server when `WORKER_IN_PROCESS` is set,
 * which is what makes a free single-service deployment possible. Both must behave
 * identically, so neither gets its own copy of this.
 *
 * Several instances running at once is safe and expected — jobs are claimed with
 * `FOR UPDATE SKIP LOCKED`, so no two workers ever take the same photo.
 */

const IDLE_DELAY_MS = 2_000;

/**
 * Housekeeping cadence, counted in idle passes (~2s each), so roughly every minute.
 *
 * Counted in passes rather than wall-clock so a worker draining a large backlog does
 * not stop to tidy up mid-flight — maintenance waits until there is nothing else to
 * do, which is exactly when it should run.
 */
const PASSES_BETWEEN_SWEEPS = 30;

export type WorkerLoopOptions = {
  /** Resolves when the loop should finish its current batch and return. */
  signal?: AbortSignal;
  /** Prefix for log lines, so in-process runs are distinguishable from the worker. */
  label?: string;
};

export async function runWorkerLoop({ signal, label = 'worker' }: WorkerLoopOptions = {}) {
  let sinceSweep = 0;

  while (!signal?.aborted) {
    const processed = await runOnce();

    if (++sinceSweep >= PASSES_BETWEEN_SWEEPS) {
      await runMaintenance();
      sinceSweep = 0;
    }

    // Only pause when there was nothing to do, so a backlog drains at full speed.
    if (processed === 0) {
      await sleep(IDLE_DELAY_MS, signal);
    }
  }

  console.warn(`[${label}] stopped`);
}

/** A delay that gives up early when the loop is asked to stop. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();

  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    signal?.addEventListener('abort', finish, { once: true });

    function finish() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    }
  });
}
