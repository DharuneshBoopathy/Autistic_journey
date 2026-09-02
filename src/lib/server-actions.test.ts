import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guard against accidentally publishing an HTTP endpoint.
 *
 * Every export of a `'use server'` module is compiled into a callable RPC endpoint
 * with a stable id, reachable by anyone who can reach the app. That makes an
 * innocuous-looking re-export a public, unauthenticated entry point.
 *
 * This is not hypothetical: `actions.ts` briefly re-exported
 * `revokeAllSessions(userId)` as a convenience, which published "terminate every
 * session belonging to any user id you name" with no authorization check of its own.
 *
 * So: in a `'use server'` file, every export must be an async function declared in
 * that same file, and must take its identity from the session rather than from an
 * argument.
 */

const SRC = path.join(process.cwd(), 'src');

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return /\.tsx?$/.test(entry.name) ? [full] : [];
    }),
  );
  return files.flat();
}

async function serverActionFiles(): Promise<string[]> {
  const all = await walk(SRC);
  const flagged = await Promise.all(
    all.map(async (file) => {
      const source = await readFile(file, 'utf8');
      // The directive must be the first statement to take effect.
      return /^\s*(['"])use server\1\s*;?/.test(source) ? file : null;
    }),
  );
  return flagged.filter((f): f is string => f !== null);
}

describe("'use server' modules", () => {
  it('exist and are discovered by this guard', async () => {
    // If this fails the scan is broken, and the assertions below would pass vacuously.
    expect((await serverActionFiles()).length).toBeGreaterThan(0);
  });

  it('export only async functions declared in the same file', async () => {
    const offences: string[] = [];

    for (const file of await serverActionFiles()) {
      const source = await readFile(file, 'utf8');
      const rel = path.relative(process.cwd(), file);

      // `export { foo }` / `export { foo } from '...'` — re-exports publish a
      // function whose body was never reviewed as an endpoint.
      for (const match of source.matchAll(/^\s*export\s*\{([^}]*)\}/gm)) {
        offences.push(`${rel}: re-export of {${match[1]!.trim()}} — move it to src/lib/`);
      }

      // `export const x = ...` — only an async arrow is a valid action; anything
      // else (an object, a constant) is not callable and signals confusion.
      for (const match of source.matchAll(/^\s*export\s+(const|let|var|class)\s+(\w+)/gm)) {
        offences.push(`${rel}: exported ${match[1]} '${match[2]}' is not an async function`);
      }

      // `export function` without `async`.
      for (const match of source.matchAll(/^\s*export\s+(?!async\b)function\s+(\w+)/gm)) {
        offences.push(`${rel}: exported function '${match[1]}' is not async`);
      }

      // `export default` — an unnamed endpoint is impossible to audit by name.
      if (/^\s*export\s+default\b/m.test(source)) {
        offences.push(`${rel}: default export in a 'use server' module`);
      }
    }

    expect(offences, `Public RPC endpoints must be reviewed:\n${offences.join('\n')}`).toEqual([]);
  });

  it('never take a user id as an argument in place of the session', async () => {
    const offences: string[] = [];

    for (const file of await serverActionFiles()) {
      const source = await readFile(file, 'utf8');
      const rel = path.relative(process.cwd(), file);

      for (const match of source.matchAll(/export\s+async\s+function\s+(\w+)\s*\(([^)]*)\)/gs)) {
        const [, name, params] = match;
        // A client-supplied user id is the classic broken-access-control shape:
        // the caller names whose account to act on. Identity must come from
        // getSessionUser(), never from a parameter.
        if (/\b(userId|user_id|actorId|accountId)\b/.test(params!)) {
          offences.push(`${rel}: action '${name}' accepts a caller-supplied user id`);
        }
      }
    }

    expect(offences, offences.join('\n')).toEqual([]);
  });
});
