import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { AuditAction, audit } from '@/lib/audit';
import { storageByName } from '@/lib/storage';

/**
 * Permanent deletion of photos whose recovery window has closed.
 *
 * Order matters: **objects first, then the row.**
 *
 * A crash between the two leaves a soft-deleted row whose objects are gone. That row
 * is already invisible to every read, and the next sweep deletes the objects again
 * (both drivers treat a missing object as success) before removing it — so the
 * failure mode is a tidy retry.
 *
 * The reverse order would leave objects in storage with nothing pointing at them:
 * invisible, unbilled to any photo, and impossible to find without diffing the
 * bucket against the database. Orphaned bytes of someone's private photograph are
 * the worse outcome, so the risk is taken in the recoverable direction.
 */

/** How many photos to purge per sweep, so one pass cannot monopolise the worker. */
const BATCH = 50;

type Doomed = {
  id: string;
  original_key: string | null;
  original_driver: string | null;
  derivatives: Array<{ key: string; driver: string }> | null;
};

export async function purgeExpired(limit = BATCH): Promise<{ purged: number; failed: number }> {
  const rows = await db.execute<Doomed>(sql`
    SELECT p.id, p.original_key, p.original_driver,
           COALESCE(
             (SELECT json_agg(json_build_object('key', d.storage_key, 'driver', d.driver))
                FROM photo_derivatives d WHERE d.photo_id = p.id),
             '[]'::json
           ) AS derivatives
      FROM photos p
     WHERE p.deleted_at IS NOT NULL
       AND p.purge_after IS NOT NULL
       AND p.purge_after < now()
     ORDER BY p.purge_after
     LIMIT ${limit}
  `);

  let purged = 0;
  let failed = 0;

  for (const photo of Array.from(rows)) {
    try {
      const objects = [
        ...(photo.derivatives ?? []),
        ...(photo.original_key && photo.original_driver
          ? [{ key: photo.original_key, driver: photo.original_driver }]
          : []),
      ];

      for (const object of objects) {
        await storageByName(object.driver).delete(object.key);
      }

      // Cascades remove derivatives, ACL rows, album membership, tags and jobs.
      await db.delete(schema.photos).where(eq(schema.photos.id, photo.id));

      // Recorded before the row is forgotten — the audit log is the only remaining
      // trace that this photo ever existed.
      await audit({
        action: AuditAction.PHOTO_PURGED,
        targetType: 'photo',
        targetId: photo.id,
        metadata: { objects: objects.length },
      });

      purged += 1;
    } catch (error) {
      // Left in place for the next sweep rather than half-deleted.
      failed += 1;
      console.error(`[purge] ${photo.id} failed:`, error instanceof Error ? error.message : error);
    }
  }

  return { purged, failed };
}
