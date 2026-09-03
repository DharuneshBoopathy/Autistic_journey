/**
 * Push originals from a backup directory back into storage.
 *
 * The counterpart to `backup-originals.ts`, and the half that is almost never
 * exercised until it matters. It only ever *adds*: an object already present in
 * storage is left alone, so running this against a healthy archive is a no-op rather
 * than a slow overwrite.
 *
 * Every file is verified against the digest recorded in the manifest before it is
 * uploaded. A corrupted backup should fail here, loudly, rather than quietly
 * replacing a good original with a bad one.
 *
 * Usage:
 *   DATABASE_URL=... npm run restore:originals -- --from /mnt/backup/originals
 *   ... --dry-run   to report what would be uploaded, and change nothing
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { client, db, schema } from '@/db';
import { originalStorage } from '@/lib/storage';

type ManifestEntry = {
  photoId: string;
  key: string;
  driver: string | null;
  bytes: number;
  sha256: string;
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const from = arg('from');
  if (!from) {
    throw new Error('Usage: npm run restore:originals -- --from <directory>');
  }
  const dryRun = process.argv.includes('--dry-run');

  const manifestPath = path.join(from, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    takenAt: string;
    entries: ManifestEntry[];
  };

  console.warn(`Manifest taken ${manifest.takenAt}, ${manifest.entries.length} originals.`);
  if (dryRun) console.warn('Dry run: nothing will be written.\n');

  const storage = originalStorage();

  let uploaded = 0;
  let present = 0;
  let corrupt = 0;
  let rekeyed = 0;

  for (const entry of manifest.entries) {
    if (await storage.exists(entry.key)) {
      present += 1;
      continue;
    }

    const bytes = await readFile(path.join(from, entry.key)).catch(() => null);
    if (!bytes) {
      console.error(`  ABSENT FROM BACKUP ${entry.photoId} ${entry.key}`);
      corrupt += 1;
      continue;
    }

    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== entry.sha256) {
      console.error(`  CORRUPT ${entry.photoId}: manifest ${entry.sha256}, file ${digest}`);
      corrupt += 1;
      continue;
    }

    if (dryRun) {
      console.warn(`  would upload ${entry.key} (${bytes.length} bytes)`);
      uploaded += 1;
      continue;
    }

    const stored = await storage.put(entry.key, bytes, { contentType: 'application/octet-stream' });

    /*
     * Some drivers assign their own key — Google Drive addresses files by an id it
     * chooses at creation, not by a path we pick. When the key comes back different
     * the database has to learn the new one, or the photo is stored and unreachable.
     */
    if (stored.key !== entry.key || storage.name !== entry.driver) {
      await db
        .update(schema.photos)
        .set({ originalKey: stored.key, originalDriver: storage.name })
        .where(eq(schema.photos.id, entry.photoId));
      if (stored.key !== entry.key) rekeyed += 1;
    }

    uploaded += 1;
  }

  console.warn(
    `\n${uploaded} ${dryRun ? 'would be uploaded' : 'uploaded'}, ${present} already in storage, ` +
      `${corrupt} unusable in the backup${rekeyed ? `, ${rekeyed} re-keyed by the driver` : ''}.`,
  );

  if (!dryRun && uploaded > 0) {
    // Derivatives are not backed up, so anything restored here needs them rebuilt.
    const [{ count } = { count: 0 }] = await db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count FROM photos
       WHERE status = 'ready'
         AND NOT EXISTS (SELECT 1 FROM photo_derivatives d WHERE d.photo_id = photos.id)
    `);
    if (count > 0) {
      console.warn(`\n${count} photos have no derivatives. Run: npm run worker:drain`);
    }
  }

  if (corrupt > 0) process.exitCode = 1;

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
