/**
 * Migration runner.
 *
 * Applies every `drizzle/*.sql` file in filename order, inside a transaction, and
 * records what it applied. Hand-written migrations (the authorization view, grants,
 * triggers) sit alongside drizzle-kit's generated ones and are applied by the same
 * mechanism, so there is one ordering and one history.
 */
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import postgres from 'postgres';

const MIGRATIONS_DIR = path.join(process.cwd(), 'drizzle');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const sql = postgres(url, { max: 1 });

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS _migrations (
        name        text PRIMARY KEY,
        checksum    text NOT NULL,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )`;

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

    const applied = new Map(
      (await sql<{ name: string; checksum: string }[]>`SELECT name, checksum FROM _migrations`).map(
        (r) => [r.name, r.checksum],
      ),
    );

    let count = 0;

    for (const name of files) {
      const body = await readFile(path.join(MIGRATIONS_DIR, name), 'utf8');
      const checksum = createHash('sha256').update(body).digest('hex');
      const previous = applied.get(name);

      if (previous) {
        if (previous !== checksum) {
          throw new Error(
            `Migration ${name} has changed since it was applied.\n` +
              'Applied migrations are immutable — add a new migration instead.',
          );
        }
        continue;
      }

      // Each migration is atomic: a failure halfway through leaves nothing behind.
      await sql.begin(async (tx) => {
        // `unsafe` is correct here and only here: migrations are developer-authored
        // files checked into the repo, not input. Nothing user-supplied reaches it.
        await tx.unsafe(body);
        await tx`INSERT INTO _migrations (name, checksum) VALUES (${name}, ${checksum})`;
      });

      console.warn(`applied  ${name}`);
      count += 1;
    }

    console.warn(count === 0 ? 'Already up to date.' : `Applied ${count} migration(s).`);
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
