/**
 * Boot-time configuration check. Node runtime only — see `instrumentation.ts`.
 *
 * Importing `env` is the whole point: it validates on first evaluation and throws a
 * sentence written for a human. Doing it here, at module scope, means a
 * misconfigured process dies before it ever accepts a connection.
 */
export {};

try {
  await import('@/lib/env');
} catch (error) {
  console.error(
    `\nThe archive cannot start:\n\n${error instanceof Error ? error.message : String(error)}\n`,
  );
  // Explicit, because Next logs an error thrown from `register()` and carries on
  // serving — which is exactly the behaviour this file exists to prevent.
  process.exit(1);
}
