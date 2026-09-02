import 'server-only';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, schema, withViewer, type Tx } from '@/db';
import { AuditAction, audit } from '@/lib/audit';
import { hasRole } from '@/lib/auth';
import type { PhotoCard } from '@/lib/gallery';
import type { SessionUser } from '@/lib/session';

/**
 * Albums — ordered, curated collections.
 *
 * **An album is a grouping, never a grant.** Its contents are always read through
 * `visible_photos`, so adding a photo to an album someone can open does not let them
 * see a photo they were not already entitled to. This is the single most important
 * property here: the obvious implementation — join `album_photos` to `photos` — would
 * quietly turn every album into a way around the visibility model.
 *
 * The consequence is that two members can open the same album and see different
 * numbers of photos. That is correct, and the UI says so rather than hiding it.
 */

export type AlbumFailure = 'not_found' | 'invalid_photo';
export type AlbumResult<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; reason: AlbumFailure };

export type AlbumSummary = {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  visibility: string;
  isMine: boolean;
  /** Photos in this album that *this viewer* may see. */
  visibleCount: number;
};

const uuidish = /^[0-9a-f-]{36}$/i;

/**
 * Albums the viewer may open: their own, plus batch-visible ones.
 *
 * Album visibility is deliberately limited to `batch` and `private`. Finer-grained
 * album sharing would suggest a level of control it cannot actually deliver, since
 * the photos inside carry their own access rules regardless.
 */
export async function listAlbums(user: SessionUser): Promise<AlbumSummary[]> {
  return withViewer(user, async (tx: Tx) => {
    const rows = await tx.execute<{
      id: string;
      name: string;
      description: string | null;
      owner_id: string;
      visibility: string;
      visible_count: number;
    }>(sql`
      SELECT a.id, a.name, a.description, a.owner_id, a.visibility::text AS visibility,
             (SELECT count(*)::int
                FROM album_photos ap
                JOIN visible_photos p ON p.id = ap.photo_id
               WHERE ap.album_id = a.id) AS visible_count
        FROM albums a
       WHERE a.batch_id = ${user.batchId}::uuid
         AND a.deleted_at IS NULL
         AND (a.visibility = 'batch' OR a.owner_id = ${user.id}::uuid)
       ORDER BY a.name
    `);

    return Array.from(rows).map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      ownerId: r.owner_id,
      visibility: r.visibility,
      isMine: r.owner_id === user.id,
      visibleCount: Number(r.visible_count),
    }));
  });
}

/** An album's photos, in curation order, filtered to what the viewer may see. */
export async function getAlbumPhotos(
  user: SessionUser,
  albumId: string,
): Promise<AlbumResult<{ name: string; photos: PhotoCard[] }>> {
  if (!uuidish.test(albumId)) return { ok: false, reason: 'not_found' };

  return withViewer(user, async (tx: Tx) => {
    const albumRows = await tx.execute<{ id: string; name: string }>(sql`
      SELECT a.id, a.name FROM albums a
       WHERE a.id = ${albumId}::uuid
         AND a.batch_id = ${user.batchId}::uuid
         AND a.deleted_at IS NULL
         AND (a.visibility = 'batch' OR a.owner_id = ${user.id}::uuid)
       LIMIT 1
    `);

    const album = Array.from(albumRows)[0];
    if (!album) return { ok: false as const, reason: 'not_found' as const };

    // The join is to visible_photos, not photos. This is the line that keeps an
    // album from becoming a way around the visibility model.
    const rows = await tx.execute<{
      id: string;
      taken_at: string;
      width: number;
      height: number;
      caption: string | null;
      visibility: PhotoCard['visibility'];
      uploader_name: string;
      uploader_id: string;
    }>(sql`
      SELECT p.id, p.taken_at, p.width, p.height, p.caption, p.visibility,
             u.display_name AS uploader_name, p.uploader_id
        FROM album_photos ap
        JOIN visible_photos p ON p.id = ap.photo_id
        JOIN users u ON u.id = p.uploader_id
       WHERE ap.album_id = ${albumId}::uuid
       ORDER BY ap.position, ap.created_at
    `);

    return {
      ok: true as const,
      value: {
        name: album.name,
        photos: Array.from(rows).map((r) => ({
          id: r.id,
          takenAt: new Date(r.taken_at).toISOString(),
          width: r.width,
          height: r.height,
          caption: r.caption,
          visibility: r.visibility,
          uploaderName: r.uploader_name,
          isMine: r.uploader_id === user.id,
          thumbWidth: null,
          thumbHeight: null,
        })),
      },
    };
  });
}

export async function createAlbum(
  user: SessionUser,
  input: { name: string; description?: string | null; visibility?: 'batch' | 'private' },
): Promise<AlbumResult<{ id: string }>> {
  const [album] = await db
    .insert(schema.albums)
    .values({
      batchId: user.batchId,
      name: input.name.trim().slice(0, 160) || 'Untitled album',
      description: input.description?.slice(0, 1000) ?? null,
      ownerId: user.id,
      visibility: input.visibility ?? 'private',
    })
    .returning({ id: schema.albums.id });

  return { ok: true, value: { id: album!.id } };
}

/** Owner-or-admin, resolved from the stored row. */
async function loadOwned(
  tx: Tx | typeof db,
  user: SessionUser,
  albumId: string,
): Promise<{ id: string } | null> {
  if (!uuidish.test(albumId)) return null;

  const [album] = await tx
    .select({ id: schema.albums.id, ownerId: schema.albums.ownerId })
    .from(schema.albums)
    .where(
      and(
        eq(schema.albums.id, albumId),
        eq(schema.albums.batchId, user.batchId),
        isNull(schema.albums.deletedAt),
      ),
    )
    .limit(1);

  if (!album) return null;
  if (album.ownerId !== user.id && !hasRole(user, 'admin')) return null;
  return { id: album.id };
}

export async function updateAlbum(
  user: SessionUser,
  albumId: string,
  input: { name?: string; description?: string | null; visibility?: 'batch' | 'private' },
): Promise<AlbumResult> {
  const album = await loadOwned(db, user, albumId);
  if (!album) return { ok: false, reason: 'not_found' };

  await db
    .update(schema.albums)
    .set({
      ...(input.name !== undefined && { name: input.name.trim().slice(0, 160) }),
      ...(input.description !== undefined && {
        description: input.description?.slice(0, 1000) ?? null,
      }),
      ...(input.visibility !== undefined && { visibility: input.visibility }),
    })
    .where(eq(schema.albums.id, albumId));

  if (input.visibility !== undefined) {
    await audit({
      action: AuditAction.ALBUM_VISIBILITY_CHANGED,
      actorId: user.id,
      actorEmail: user.email,
      targetType: 'album',
      targetId: albumId,
      metadata: { to: input.visibility },
    });
  }

  return { ok: true, value: undefined };
}

export async function deleteAlbum(user: SessionUser, albumId: string): Promise<AlbumResult> {
  const album = await loadOwned(db, user, albumId);
  if (!album) return { ok: false, reason: 'not_found' };

  // Soft delete: the album disappears, the photos in it are untouched.
  await db
    .update(schema.albums)
    .set({ deletedAt: new Date() })
    .where(eq(schema.albums.id, albumId));

  return { ok: true, value: undefined };
}

/**
 * Add photos to an album.
 *
 * Only photos the caller can *see* may be added — checked through `visible_photos`.
 * Without that, a member could add an id they cannot see and then read its metadata
 * back through the album listing, turning curation into an oracle.
 */
export async function addPhotosToAlbum(
  user: SessionUser,
  albumId: string,
  photoIds: string[],
): Promise<AlbumResult<{ added: number }>> {
  const ids = [...new Set(photoIds)].filter((id) => uuidish.test(id)).slice(0, 500);
  if (ids.length === 0) return { ok: false, reason: 'invalid_photo' };

  const album = await loadOwned(db, user, albumId);
  if (!album) return { ok: false, reason: 'not_found' };

  const added = await withViewer(user, async (tx: Tx) => {
    const rows = await tx.execute<{ inserted: number }>(sql`
      WITH allowed AS (
        -- Each id is bound as its own parameter via sql.join. Passing the array
        -- directly yields "cannot cast type record to uuid[]" — drizzle binds a JS
        -- array as a row constructor, not a Postgres array — and interpolating the
        -- ids as text would be the SQL-by-concatenation habit this codebase refuses.
        SELECT p.id FROM visible_photos p
         WHERE p.id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
      ),
      next_pos AS (
        SELECT coalesce(max(position), -1) + 1 AS start FROM album_photos WHERE album_id = ${albumId}::uuid
      )
      INSERT INTO album_photos (album_id, photo_id, position, added_by)
      SELECT ${albumId}::uuid, a.id,
             (SELECT start FROM next_pos) + (row_number() OVER (ORDER BY a.id)) - 1,
             ${user.id}::uuid
        FROM allowed a
      ON CONFLICT (album_id, photo_id) DO NOTHING
      RETURNING 1 AS inserted
    `);
    return Array.from(rows).length;
  });

  return { ok: true, value: { added } };
}

export async function removePhotosFromAlbum(
  user: SessionUser,
  albumId: string,
  photoIds: string[],
): Promise<AlbumResult<{ removed: number }>> {
  const ids = [...new Set(photoIds)].filter((id) => uuidish.test(id)).slice(0, 500);
  if (ids.length === 0) return { ok: false, reason: 'invalid_photo' };

  const album = await loadOwned(db, user, albumId);
  if (!album) return { ok: false, reason: 'not_found' };

  const removed = await db
    .delete(schema.albumPhotos)
    .where(and(eq(schema.albumPhotos.albumId, albumId), inArray(schema.albumPhotos.photoId, ids)))
    .returning({ photoId: schema.albumPhotos.photoId });

  return { ok: true, value: { removed: removed.length } };
}
