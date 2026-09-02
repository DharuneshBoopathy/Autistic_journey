import 'server-only';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema, withViewer, type Tx } from '@/db';
import { hasRole } from '@/lib/auth';
import type { SessionUser } from '@/lib/session';

/**
 * Events and tags — the two flat taxonomies photos are filed under.
 *
 * Kept together because both are the same shape: a batch-scoped label, created by
 * any member, attached to photos they may already see. Neither confers access;
 * filtering by either still reads through `visible_photos`.
 */

export type TaxonomyFailure = 'not_found' | 'forbidden' | 'invalid';
export type TaxonomyResult<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; reason: TaxonomyFailure };

const uuidish = /^[0-9a-f-]{36}$/i;

// --- Events ------------------------------------------------------------------

export type EventSummary = {
  id: string;
  name: string;
  academicYear: string | null;
  startsOn: string | null;
  endsOn: string | null;
  /** Photos in this event that this viewer may see. */
  visibleCount: number;
};

/**
 * Events in the batch, with viewer-scoped counts.
 *
 * The count comes from `visible_photos`, so an event never advertises how many
 * photos exist inside it that the viewer is not permitted to open.
 */
export async function listEvents(user: SessionUser): Promise<EventSummary[]> {
  return withViewer(user, async (tx: Tx) => {
    const rows = await tx.execute<{
      id: string;
      name: string;
      academic_year: string | null;
      starts_on: string | null;
      ends_on: string | null;
      visible_count: number;
    }>(sql`
      SELECT e.id, e.name, e.academic_year, e.starts_on, e.ends_on,
             (SELECT count(*)::int FROM visible_photos p WHERE p.event_id = e.id) AS visible_count
        FROM events e
       WHERE e.batch_id = ${user.batchId}::uuid
       ORDER BY e.starts_on DESC NULLS LAST, e.name
    `);

    return Array.from(rows).map((r) => ({
      id: r.id,
      name: r.name,
      academicYear: r.academic_year,
      startsOn: r.starts_on ? new Date(r.starts_on).toISOString() : null,
      endsOn: r.ends_on ? new Date(r.ends_on).toISOString() : null,
      visibleCount: Number(r.visible_count),
    }));
  });
}

export async function createEvent(
  user: SessionUser,
  input: { name: string; academicYear?: string | null; startsOn?: Date | null; endsOn?: Date | null },
): Promise<TaxonomyResult<{ id: string }>> {
  const name = input.name.trim().slice(0, 160);
  if (!name) return { ok: false, reason: 'invalid' };

  const [event] = await db
    .insert(schema.events)
    .values({
      batchId: user.batchId,
      name,
      academicYear: input.academicYear?.slice(0, 40) ?? null,
      startsOn: input.startsOn ?? null,
      endsOn: input.endsOn ?? null,
      createdBy: user.id,
    })
    .returning({ id: schema.events.id });

  return { ok: true, value: { id: event!.id } };
}

/**
 * Delete an event. Admin only.
 *
 * Members may create events freely — mislabelling is cheap to fix — but deleting one
 * detaches it from every photo filed under it, which is not.
 * `photos.event_id` is ON DELETE SET NULL, so the photos survive; only the grouping
 * is lost.
 */
export async function deleteEvent(user: SessionUser, eventId: string): Promise<TaxonomyResult> {
  if (!uuidish.test(eventId)) return { ok: false, reason: 'not_found' };
  if (!hasRole(user, 'admin')) return { ok: false, reason: 'forbidden' };

  const deleted = await db
    .delete(schema.events)
    .where(and(eq(schema.events.id, eventId), eq(schema.events.batchId, user.batchId)))
    .returning({ id: schema.events.id });

  return deleted.length > 0
    ? { ok: true, value: undefined }
    : { ok: false, reason: 'not_found' };
}

// --- Tags --------------------------------------------------------------------

/**
 * Attach tags to a photo, creating any that do not exist yet.
 *
 * Only photos the caller may see can be tagged, checked through `visible_photos` —
 * otherwise tagging would confirm whether an id names a real photo.
 */
export async function tagPhoto(
  user: SessionUser,
  photoId: string,
  tagNames: string[],
): Promise<TaxonomyResult<{ attached: number }>> {
  if (!uuidish.test(photoId)) return { ok: false, reason: 'not_found' };

  const names = [...new Set(tagNames.map((t) => t.trim().toLowerCase()).filter(Boolean))]
    .map((t) => t.slice(0, 60))
    .slice(0, 30);

  if (names.length === 0) return { ok: false, reason: 'invalid' };

  const visible = await withViewer(user, async (tx: Tx) => {
    const rows = await tx.execute<{ id: string }>(
      sql`SELECT id FROM visible_photos WHERE id = ${photoId}::uuid LIMIT 1`,
    );
    return Array.from(rows).length > 0;
  });

  if (!visible) return { ok: false, reason: 'not_found' };

  const attached = await db.transaction(async (tx) => {
    // Upsert the tag rows, then attach. The unique index on (batch_id, name) makes
    // this safe under concurrency without a lock.
    await tx
      .insert(schema.tags)
      .values(names.map((name) => ({ batchId: user.batchId, name })))
      .onConflictDoNothing();

    const rows = await tx
      .select({ id: schema.tags.id })
      .from(schema.tags)
      .where(and(eq(schema.tags.batchId, user.batchId), inArray(schema.tags.name, names)));

    if (rows.length === 0) return 0;

    const inserted = await tx
      .insert(schema.photoTags)
      .values(rows.map((t) => ({ photoId, tagId: t.id, addedBy: user.id })))
      .onConflictDoNothing()
      .returning({ tagId: schema.photoTags.tagId });

    return inserted.length;
  });

  return { ok: true, value: { attached } };
}

export async function untagPhoto(
  user: SessionUser,
  photoId: string,
  tagNames: string[],
): Promise<TaxonomyResult<{ removed: number }>> {
  if (!uuidish.test(photoId)) return { ok: false, reason: 'not_found' };

  const names = [...new Set(tagNames.map((t) => t.trim().toLowerCase()).filter(Boolean))];
  if (names.length === 0) return { ok: false, reason: 'invalid' };

  const visible = await withViewer(user, async (tx: Tx) => {
    const rows = await tx.execute<{ id: string }>(
      sql`SELECT id FROM visible_photos WHERE id = ${photoId}::uuid LIMIT 1`,
    );
    return Array.from(rows).length > 0;
  });

  if (!visible) return { ok: false, reason: 'not_found' };

  const removed = await db.execute<{ tag_id: string }>(sql`
    DELETE FROM photo_tags pt
     USING tags t
     WHERE pt.tag_id = t.id
       AND pt.photo_id = ${photoId}::uuid
       AND t.batch_id = ${user.batchId}::uuid
       AND t.name IN (${sql.join(names.map((n) => sql`${n}`), sql`, `)})
    RETURNING pt.tag_id
  `);

  return { ok: true, value: { removed: Array.from(removed).length } };
}

/** Tags in use on photos the viewer can see, most-used first. */
export async function listTags(user: SessionUser, limit = 100): Promise<Array<{ name: string; count: number }>> {
  return withViewer(user, async (tx: Tx) => {
    const rows = await tx.execute<{ name: string; count: number }>(sql`
      SELECT t.name, count(*)::int AS count
        FROM visible_photos p
        JOIN photo_tags pt ON pt.photo_id = p.id
        JOIN tags t ON t.id = pt.tag_id
       GROUP BY t.name
       ORDER BY count DESC, t.name
       LIMIT ${limit}
    `);
    return Array.from(rows).map((r) => ({ name: r.name, count: Number(r.count) }));
  });
}
