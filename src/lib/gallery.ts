import 'server-only';
import { sql } from 'drizzle-orm';
import { withViewer, type Tx } from '@/db';
import type { SessionUser } from '@/lib/session';

/**
 * Reads for the gallery.
 *
 * Every query in this file selects from `visible_photos`, never from `photos`. That
 * is the whole reason the predicate lives in a view: search, filters, counts and
 * facets are permission-filtered *before* they are aggregated, so a restricted photo
 * cannot leak through a result count or an autocomplete suggestion — it is not in
 * the set being counted.
 */

export type PhotoCard = {
  id: string;
  takenAt: string;
  width: number;
  height: number;
  caption: string | null;
  visibility: 'batch' | 'group' | 'selected' | 'private';
  uploaderName: string;
  isMine: boolean;
  thumbWidth: number | null;
  thumbHeight: number | null;
};

export type TimelineFilters = {
  academicYear?: string;
  eventId?: string;
  uploaderId?: string;
  albumId?: string;
  tag?: string;
  campusZone?: string;
  /** Free text, matched against the stored tsvector. */
  q?: string;
};

export type TimelinePage = {
  photos: PhotoCard[];
  nextCursor: string | null;
};

const PAGE_SIZE = 60;

/**
 * Encode a keyset cursor.
 *
 * Not signed, and it does not need to be: the cursor only moves the window, and
 * every row returned still passes the predicate. A tampered cursor can shift where
 * a viewer looks, never what they are allowed to see.
 */
function encodeCursor(takenAt: string, id: string): string {
  return Buffer.from(`${takenAt}|${id}`).toString('base64url');
}

function decodeCursor(cursor: string): { takenAt: string; id: string } | null {
  try {
    const [takenAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (!takenAt || !id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    return { takenAt, id };
  } catch {
    return null;
  }
}

/** SQL fragments for the optional filters, combined with AND. */
function filterClauses(filters: TimelineFilters) {
  const clauses = [];

  if (filters.academicYear) clauses.push(sql`p.academic_year = ${filters.academicYear}`);
  if (filters.eventId) clauses.push(sql`p.event_id = ${filters.eventId}::uuid`);
  if (filters.uploaderId) clauses.push(sql`p.uploader_id = ${filters.uploaderId}::uuid`);
  if (filters.campusZone) clauses.push(sql`p.campus_zone = ${filters.campusZone}::campus_zone`);

  if (filters.albumId) {
    clauses.push(
      sql`EXISTS (SELECT 1 FROM album_photos ap
                  WHERE ap.photo_id = p.id AND ap.album_id = ${filters.albumId}::uuid)`,
    );
  }

  if (filters.tag) {
    clauses.push(
      sql`EXISTS (SELECT 1 FROM photo_tags pt JOIN tags t ON t.id = pt.tag_id
                  WHERE pt.photo_id = p.id AND t.name = ${filters.tag})`,
    );
  }

  if (filters.q?.trim()) {
    // websearch_to_tsquery accepts what people actually type — quoted phrases,
    // OR, leading minus — without throwing on malformed input the way
    // to_tsquery does.
    clauses.push(sql`p.search_vector @@ websearch_to_tsquery('english', ${filters.q.trim()})`);
  }

  return clauses;
}

function andAll(clauses: ReturnType<typeof filterClauses>) {
  return clauses.length === 0 ? sql`TRUE` : sql.join(clauses, sql` AND `);
}

/**
 * One page of the chronological timeline, newest first.
 *
 * Keyset pagination on `(taken_at, id)` rather than OFFSET: at 100k photos an
 * OFFSET scan re-reads and discards every earlier row, so page 500 costs 500 pages
 * of work. The `photos_timeline_idx` partial index matches this ordering exactly.
 */
export async function getTimeline(
  viewer: SessionUser,
  options: { cursor?: string; filters?: TimelineFilters; limit?: number } = {},
): Promise<TimelinePage> {
  const limit = Math.min(options.limit ?? PAGE_SIZE, 200);
  const cursor = options.cursor ? decodeCursor(options.cursor) : null;
  const filters = andAll(filterClauses(options.filters ?? {}));

  const rows = await withViewer(viewer, async (tx: Tx) => {
    const result = await tx.execute<{
      id: string;
      taken_at: string;
      width: number;
      height: number;
      caption: string | null;
      visibility: PhotoCard['visibility'];
      uploader_name: string;
      uploader_id: string;
      thumb_width: number | null;
      thumb_height: number | null;
    }>(sql`
      SELECT p.id, p.taken_at, p.width, p.height, p.caption, p.visibility,
             u.display_name AS uploader_name, p.uploader_id,
             d.width AS thumb_width, d.height AS thumb_height
        FROM visible_photos p
        JOIN users u ON u.id = p.uploader_id
        LEFT JOIN photo_derivatives d ON d.photo_id = p.id AND d.kind = 'thumb'
       WHERE ${filters}
         AND (${cursor ? sql`(p.taken_at, p.id) < (${cursor.takenAt}::timestamptz, ${cursor.id}::uuid)` : sql`TRUE`})
       ORDER BY p.taken_at DESC, p.id DESC
       LIMIT ${limit + 1}
    `);
    return Array.from(result);
  });

  // Fetching one extra row is how we know whether another page exists without a
  // second COUNT query over the whole set.
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  return {
    photos: page.map((r) => ({
      id: r.id,
      takenAt: new Date(r.taken_at).toISOString(),
      width: r.width,
      height: r.height,
      caption: r.caption,
      visibility: r.visibility,
      uploaderName: r.uploader_name,
      isMine: r.uploader_id === viewer.id,
      thumbWidth: r.thumb_width,
      thumbHeight: r.thumb_height,
    })),
    nextCursor: hasMore && last ? encodeCursor(last.taken_at, last.id) : null,
  };
}

export type PhotoDetail = PhotoCard & {
  academicYear: string | null;
  semester: string | null;
  locationText: string | null;
  campusZone: string;
  eventName: string | null;
  originalFilename: string | null;
  tags: string[];
};

/** Full metadata for the lightbox. Returns null when the viewer may not see it. */
export async function getPhoto(viewer: SessionUser, id: string): Promise<PhotoDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;

  return withViewer(viewer, async (tx: Tx) => {
    const result = await tx.execute<{
      id: string;
      taken_at: string;
      width: number;
      height: number;
      caption: string | null;
      visibility: PhotoDetail['visibility'];
      uploader_name: string;
      uploader_id: string;
      academic_year: string | null;
      semester: string | null;
      location_text: string | null;
      campus_zone: string;
      event_name: string | null;
      original_filename: string | null;
      tags: string[] | null;
    }>(sql`
      SELECT p.id, p.taken_at, p.width, p.height, p.caption, p.visibility,
             u.display_name AS uploader_name, p.uploader_id,
             p.academic_year, p.semester, p.location_text, p.campus_zone,
             e.name AS event_name, p.original_filename,
             ARRAY(SELECT t.name FROM photo_tags pt JOIN tags t ON t.id = pt.tag_id
                    WHERE pt.photo_id = p.id ORDER BY t.name) AS tags
        FROM visible_photos p
        JOIN users u ON u.id = p.uploader_id
        LEFT JOIN events e ON e.id = p.event_id
       WHERE p.id = ${id}::uuid
       LIMIT 1
    `);

    const row = Array.from(result)[0];
    if (!row) return null;

    return {
      id: row.id,
      takenAt: new Date(row.taken_at).toISOString(),
      width: row.width,
      height: row.height,
      caption: row.caption,
      visibility: row.visibility,
      uploaderName: row.uploader_name,
      isMine: row.uploader_id === viewer.id,
      thumbWidth: null,
      thumbHeight: null,
      academicYear: row.academic_year,
      semester: row.semester,
      locationText: row.location_text,
      campusZone: row.campus_zone,
      eventName: row.event_name,
      originalFilename: row.original_filename,
      tags: row.tags ?? [],
    };
  });
}

export type Facet = { value: string; label: string; count: number };

/**
 * Counts for the filter sidebar.
 *
 * Computed over `visible_photos`, so the numbers a member sees describe only what
 * that member can reach. A facet count taken over the whole table would say
 * "Graduation (48)" to someone permitted to see three of them — which discloses the
 * existence of forty-five photos they were never meant to know about.
 */
export async function getFacets(viewer: SessionUser): Promise<{
  academicYears: Facet[];
  events: Facet[];
  uploaders: Facet[];
  total: number;
}> {
  return withViewer(viewer, async (tx: Tx) => {
    const [years, events, uploaders, totals] = await Promise.all([
      tx.execute<{ value: string; count: number }>(sql`
        SELECT academic_year AS value, count(*)::int AS count
          FROM visible_photos WHERE academic_year IS NOT NULL
         GROUP BY academic_year ORDER BY academic_year`),
      tx.execute<{ value: string; label: string; count: number }>(sql`
        SELECT e.id::text AS value, e.name AS label, count(*)::int AS count
          FROM visible_photos p JOIN events e ON e.id = p.event_id
         GROUP BY e.id, e.name ORDER BY count DESC, e.name LIMIT 50`),
      tx.execute<{ value: string; label: string; count: number }>(sql`
        SELECT u.id::text AS value, u.display_name AS label, count(*)::int AS count
          FROM visible_photos p JOIN users u ON u.id = p.uploader_id
         GROUP BY u.id, u.display_name ORDER BY count DESC, u.display_name LIMIT 50`),
      tx.execute<{ count: number }>(sql`SELECT count(*)::int AS count FROM visible_photos`),
    ]);

    return {
      academicYears: Array.from(years).map((r) => ({
        value: r.value,
        label: r.value,
        count: Number(r.count),
      })),
      events: Array.from(events).map((r) => ({
        value: r.value,
        label: r.label,
        count: Number(r.count),
      })),
      uploaders: Array.from(uploaders).map((r) => ({
        value: r.value,
        label: r.label,
        count: Number(r.count),
      })),
      total: Number(Array.from(totals)[0]?.count ?? 0),
    };
  });
}

/**
 * Tag suggestions for the search box.
 *
 * Restricted to tags that appear on at least one photo the viewer can see. Suggesting
 * from the whole tag table would let someone type a letter and learn the names of
 * events and people in photos they have no access to — a slower but equally real
 * version of the same leak the facet counts avoid.
 */
export async function suggestTags(viewer: SessionUser, prefix: string): Promise<string[]> {
  const term = prefix.trim();
  if (term.length < 1) return [];

  return withViewer(viewer, async (tx: Tx) => {
    const result = await tx.execute<{ name: string }>(sql`
      SELECT DISTINCT t.name
        FROM visible_photos p
        JOIN photo_tags pt ON pt.photo_id = p.id
        JOIN tags t ON t.id = pt.tag_id
       WHERE t.name ILIKE ${term + '%'}
       ORDER BY t.name
       LIMIT 10`);
    return Array.from(result).map((r) => r.name);
  });
}
