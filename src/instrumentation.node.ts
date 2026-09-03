/**
 * Boot-time work for the Node runtime. See `instrumentation.ts`.
 *
 * Two jobs: fail fast on a bad configuration, and — when the deployment has nowhere
 * to run a second process — start the derivative worker in this one.
 */
import { env } from '@/lib/env';

export {};

/*
 * Importing `env` above is itself the configuration check: it validates on first
 * evaluation and throws a sentence written for a human. Doing it here, at module
 * scope, means a misconfigured process dies before it ever accepts a connection.
 */
if (env.WORKER_IN_PROCESS) {
  /*
   * Imported lazily so a deployment running the worker properly — as its own
   * process — never pulls `sharp` and the job queue into its web server at all.
   */
  const { runWorkerLoop } = await import('@/worker/loop');

  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  console.warn(
    '[worker] running inside the web server (WORKER_IN_PROCESS). A large resize will ' +
      'compete with page loads; the separate worker process is the better shape where ' +
      'the host will run one.',
  );

  /*
   * Deliberately not awaited. `register()` blocks the server from accepting
   * connections until it resolves, and this loop only resolves at shutdown — so
   * awaiting it would mean the site never comes up at all.
   */
  void runWorkerLoop({ signal: controller.signal, label: 'worker:in-process' }).catch(
    (error: unknown) => {
      // A crashed loop must be loud. It is the difference between "photos are slow"
      // and "photos never appear", and the second is indistinguishable from working
      // until someone goes looking.
      console.error('[worker] in-process loop stopped unexpectedly', error);
    },
  );
}
