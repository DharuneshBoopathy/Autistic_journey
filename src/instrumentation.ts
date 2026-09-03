/**
 * Runs once, when the server process starts.
 *
 * Its only job is to force `env.ts` to be evaluated at boot rather than on the
 * first request that happens to import it.
 *
 * Without this, a deployment configured with the local storage driver, or with a
 * plain-http origin, starts cleanly and reports itself ready — and only then
 * answers every request with a 500. The failure arrives at the worst moment, from
 * the least informative place, and an operator watching the logs sees a stack trace
 * inside a bundled chunk rather than the sentence `env.ts` wrote for them.
 *
 * Failing here instead means a misconfigured instance never comes up at all, which
 * is what a rolling deploy needs in order to stop and keep the previous version.
 *
 * The work itself lives in `./instrumentation.node`, behind a dynamic import: this
 * file is compiled for the edge runtime as well, where `process.exit` does not
 * exist. Keeping the guard and the Node-only code in separate modules is what stops
 * that being a build-time warning on every start.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  await import('./instrumentation.node');
}
