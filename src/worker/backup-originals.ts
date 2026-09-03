/**
 * Copy every original out of storage into a directory you control.
 *
 * Originals are the only irreplaceable bytes in the archive. Thumbnails and previews
 * are derived from them and are rebuilt by `npm run worker:drain`, so they are
 * deliberately not copied here — backing them up would triple the transfer for data
 * a CPU can regenerate.
 *
 * The destination is a plain directory rather than another provider. That is not a
 * shortcut: it is the shape that composes with whatever you already trust to hold a
 * directory — rclone to a second bucket, an external disk, a friend's NAS — instead
 * of this file growing a driver for each of them.
 *
 * Runs as a plain Node process (`npx tsx`), like the other entry points here, so it
 * must not import anything carrying `server-only`. `worker-imports.test.ts` enforces
 * that for every file in this directory.
 *
 * Usage:
 *   DATABASE_URL=... npm run backup:originals -- --to /mnt/backup/originals
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { sql } from 'drizzle-orm';
import { client, db } from '@/db';
import { originalStorage } from '@/lib/storage';

type Row = {
  id: string;
  original_key: string;
  original_driver: string | null;
  /*
   * `original_bytes` is a bigint, and a raw query hands it back as a string —
   * drizzle's `mode: 'number'` only applies to its own column builders. Comparing
   * it to a file size with `===` silently never matched, so every run re-copied the
   * whole archive while reporting "0 already present".
   */
  original_bytes: string | number | null;
  sha256: string | null;
};

type ManifestEntry = {
  photoId: string;
  key: string;
  driver: string | null;
  bytes: number;
  sha256: string;
  /** Whether the bytes on disk match the digest the database recorded at upload. */
  matchesDatabase: boolean;
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const dest = arg('to');
  if (!dest) {
    throw new Error('Usage: npm run backup:originals -- --to <directory>');
  }

  await mkdir(dest, { recursive: true });
  const storage = originalStorage();
  const manifestPath = path.join(dest, 'manifest.json');

  /*
   * The previous manifest, keyed by storage key.
   *
   * A file already present is not re-read — at 100k photos that would be hundreds
   * of gigabytes of hashing per run — so its manifest entry has to be carried
   * forward from last time. Writing only this run's copies would leave the second
   * run with a manifest describing almost nothing, and the restore reads exactly
   * that file.
   */
  const previous = new Map<string, ManifestEntry>();
  try {
    const old = JSON.parse(await readFile(manifestPath, 'utf8')) as { entries: ManifestEntry[] };
    for (const entry of old.entries) previous.set(entry.key, entry);
  } catch {
    /* first run, or an unreadable manifest: rebuild it from scratch */
  }

  /*
   * Soft-deleted photos are included on purpose. They are restorable until
   * `purge_after`, so a backup that skipped them would quietly make "restore from
   * Trash" fail for anything recovered from the backup. Purged rows are gone from
   * this table entirely, so they cannot be picked up here.
   */
  const rows = await db.execute<Row>(sql`
    SELECT id, original_key, original_driver, original_bytes, sha256
      FROM photos
     WHERE original_key IS NOT NULL
     ORDER BY uploaded_at
  `);

  const manifest: ManifestEntry[] = [];
  let copied = 0;
  let skipped = 0;
  let missing = 0;
  let mismatched = 0;

  for (const row of Array.from(rows)) {
    const target = path.join(dest, row.original_key);
    await mkdir(path.dirname(target), { recursive: true });

    // Already there at the right size? Leave it, and carry its manifest entry over.
    // This is what makes the second run over 100k photos cheap, and what lets an
    // interrupted run simply be repeated.
    const existing = await stat(target).catch(() => null);
    const carried = previous.get(row.original_key);
    const expectedBytes = row.original_bytes === null ? null : Number(row.original_bytes);
    if (existing && carried && expectedBytes !== null && existing.size === expectedBytes) {
      manifest.push(carried);
      skipped += 1;
      continue;
    }

    // Write to a temporary name and rename into place, so an interrupted run never
    // leaves a half-written file that the size check above would later accept.
    const temp = `${target}.partial`;
    let digest: string;

    try {
      /*
       * The read and the write share one try: a driver may only discover that an
       * object is absent once the stream is pumped, so catching around `getStream`
       * alone let a single missing original abort the backup of every photo after
       * it — the one failure mode a backup must not have.
       */
      const stream = await storage.getStream(row.original_key);
      const hash = createHash('sha256');
      const node = Readable.fromWeb(stream as Parameters<typeof Readable.fromWeb>[0]);
      node.on('data', (chunk: Buffer) => hash.update(chunk));

      await pipeline(node, createWriteStream(temp, { mode: 0o600 }));
      digest = hash.digest('hex');
    } catch {
      await rm(temp, { force: true });
      // The row says there is an object and storage disagrees. That is exactly the
      // kind of silent loss a backup exists to surface, so it is counted and named
      // rather than swallowed — and the run continues.
      console.error(`  MISSING ${row.id} ${row.original_key}`);
      missing += 1;
      continue;
    }

    await rename(temp, target);

    const written = await stat(target);
    const matches = row.sha256 === null || row.sha256 === digest;
    if (!matches) {
      console.error(`  DIGEST MISMATCH ${row.id}: database ${row.sha256}, storage ${digest}`);
      mismatched += 1;
    }

    manifest.push({
      photoId: row.id,
      key: row.original_key,
      driver: row.original_driver,
      bytes: written.size,
      sha256: digest,
      matchesDatabase: matches,
    });
    copied += 1;
  }

  // The manifest is what the restore reads. It is rewritten whole each run — from
  // this run's copies plus the carried-forward entries — so it always describes the
  // directory as it now stands.
  await writeFile(
    manifestPath,
    JSON.stringify({ takenAt: new Date().toISOString(), entries: manifest }, null, 2),
    { mode: 0o600 },
  );

  console.warn(
    `\n${copied} copied, ${skipped} already present, ${missing} missing from storage, ` +
      `${mismatched} with a digest the database disagrees with.`,
  );
  console.warn(`Manifest: ${manifestPath}`);

  if (missing > 0 || mismatched > 0) {
    console.error('\nThis backup is incomplete. Investigate before relying on it.');
    process.exitCode = 1;
  }

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
