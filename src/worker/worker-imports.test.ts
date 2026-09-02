import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The worker runs as a plain Node process, outside Next.
 *
 * `import 'server-only'` resolves to a module that throws unless the importer is
 * running under Next's `react-server` condition. That guard is correct for anything
 * reachable from a request — it stops secrets being bundled into the browser — but a
 * worker that transitively imports it dies at startup.
 *
 * This has now bitten twice: once via `@/lib/storage`, once via `@/lib/session`
 * pulled in for session pruning. Both times the failure was a stack trace pointing
 * at line 1 of an unrelated file. This test walks the worker's real import graph so
 * the third time is caught here instead.
 */

const SRC = path.join(process.cwd(), 'src');
const ENTRY_POINTS = ['worker/index.ts', 'worker/drain.ts', 'worker/sweep.ts'];

/** Resolve an import specifier to a file on disk, or null if it is a package. */
async function resolveLocal(specifier: string, fromFile: string): Promise<string | null> {
  let base: string;

  if (specifier.startsWith('@/')) {
    base = path.join(SRC, specifier.slice(2));
  } else if (specifier.startsWith('.')) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else {
    return null; // node: builtin or npm package
  }

  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    try {
      await readFile(candidate, 'utf8');
      return candidate;
    } catch {
      /* try the next shape */
    }
  }
  return null;
}

async function importGraph(entry: string): Promise<Map<string, string>> {
  const seen = new Map<string, string>();
  const queue = [path.join(SRC, entry)];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;

    let source: string;
    try {
      source = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    seen.set(file, source);

    for (const match of source.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/g)) {
      const resolved = await resolveLocal(match[1]!, file);
      if (resolved) queue.push(resolved);
    }
    // Bare side-effect imports, e.g. `import 'server-only'`.
    for (const match of source.matchAll(/(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g)) {
      const resolved = await resolveLocal(match[1]!, file);
      if (resolved) queue.push(resolved);
    }
  }

  return seen;
}

describe('worker import graph', () => {
  it.each(ENTRY_POINTS)('%s reaches no module guarded by server-only', async (entry) => {
    const graph = await importGraph(entry);

    // A broken walker would pass vacuously.
    expect(graph.size, `${entry} should reach several modules`).toBeGreaterThan(3);

    const offenders = [...graph.entries()]
      .filter(([, source]) => /^\s*import\s+['"]server-only['"]/m.test(source))
      .map(([file]) => path.relative(process.cwd(), file));

    expect(
      offenders,
      `${entry} transitively imports 'server-only', which throws outside Next:\n` +
        offenders.join('\n'),
    ).toEqual([]);
  });
});
