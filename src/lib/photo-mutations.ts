import 'server-only';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, schema, type Tx } from '@/db';
import { env } from '@/lib/env';
import { AuditAction, audit } from '@/lib/audit';
import { hasRole } from '@/lib/auth';
import type { SessionUser } from '@/lib/session';

/**
 * Writes to a photo: visibility, sharing, metadata, deletion, restoration.
 *
 * Reading and writing have different rules, which is why this does not go through
 * `visible_photos`:
 *
 *  - The view deliberately hides soft-deleted rows, but restoring one is precisely a
 *    write against a hidden row.
 *  - Being *able to see* a photo never implies being able to change it. Every member
 *    of the batch can see a batch-visible photo; only its uploader may re-share it.
 *
 * So every function here starts from `loadForWrite()`, which reads the base table
 * and applies the write rule explicitly. This is one of the audited paths the view's
 * COMMENT permits, and it is the only place in member-facing code that touches
 * `photos` directly.
 */

export type Visibility = 'batch' | 'group' | 'selected' | 'private';

export type WriteFailure =
  | 'not_found'
  | 'forbidden'
  | 'invalid_principal'
  | 'not_deleted'
  | 'purge_window_passed';

export type WriteResult = { ok: true } | { ok: false; reason: WriteFailure };

/** For operations that return something on success, such as a recovery deadline. */
export type WriteResultWith<T> = { ok: true; value: T } | { ok: false; reason: WriteFailure };

/** The shape `bulkApply` needs: either variant, with or without a payload. */
type AnyWriteResult = { ok: true; value?: unknown } | { ok: false; reason: WriteFailure };

type WritablePhoto = {
  id: string;
  batchId: string;
  uploaderId: string;
  visibility: Visibility;
  deletedAt: Date | null;
  purgeAfter: Date | null;
};

/**
 * Load a photo the caller is entitled to modify.
 *
 * The uploader-or-admin rule is applied here, once, from the row's own
 * `uploader_id` — never from anything the client supplied. A caller naming a photo
 * they did not upload gets `not_found`, the same answer as a photo that does not
 * exist, so this cannot be used to probe which ids are real.
 */
async function loadForWrite(
  tx: Tx | typeof db,
  user: SessionUser,
  photoId: string,
  options: { includeDeleted?: boolean } = {},
): Promise<WritablePhoto | null> {
  if (!/^[0-9a-f-]{36}$/i.test(photoId)) return null;

  const [row] = await tx
    .select({
      id: schema.photos.id,
      batchId: schema.photos.batchId,
      uploaderId: schema.photos.uploaderId,
      visibility: schema.photos.visibility,
      deletedAt: schema.photos.deletedAt,
      purgeAfter: schema.photos.purgeAfter,
    })
    .from(schema.photos)
    .where(
      and(
        eq(schema.photos.id, photoId),
        // Batch isolation applies to writes exactly as it does to reads.
        eq(schema.photos.batchId, user.batchId),
        options.includeDeleted ? undefined : isNull(schema.photos.deletedAt),
      ),
    )
    .limit(1);

  if (!row) return null;
  if (row.uploaderId !== user.id && !hasRole(user, 'admin')) return null;

  return row as WritablePhoto;
}

/**
 * Verify that every principal being granted access is a real, active member of the
 * caller's own batch (or a group belonging to it).
 *
 * The authorization predicate would refuse a foreign principal anyway — it requires
 * the *viewer* to be an active member of the photo's batch — so this is not the
 * control. It exists so that sharing with someone who cannot possibly see the result
 * fails loudly at the point of sharing, instead of silently producing an ACL row
 * that never does anything.
 */
async function validatePrincipals(
  tx: Tx | typeof db,
  batchId: string,
  visibility: Visibility,
  principalIds: string[],
): Promise<boolean> {
  if (principalIds.length === 0) return false;
  if (principalIds.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) return false;

  if (visibility === 'selected') {
    const found = await tx
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(
        and(
          inArray(schema.users.id, principalIds),
          eq(schema.users.batchId, batchId),
          eq(schema.users.status, 'active'),
        ),
      );
    return found.length === principalIds.length;
  }

  const found = await tx
    .select({ id: schema.groups.id })
    .from(schema.groups)
    .where(
      and(
        inArray(schema.groups.id, principalIds),
        eq(schema.groups.batchId, batchId),
        isNull(schema.groups.deletedAt),
      ),
    );
  return found.length === principalIds.length;
}

export type SetVisibilityInput = {
  visibility: Visibility;
  /** Group ids for `group`, user ids for `selected`. Ignored otherwise. */
  principalIds?: string[];
};

/**
 * Change who can see a photo.
 *
 * Takes effect on the very next request from anyone affected: the predicate reads
 * `photo_acl` live, so there is no cached grant and no signed URL to outlive the
 * change. Narrowing visibility genuinely revokes access rather than merely hiding
 * the photo from a listing.
 *
 * The ACL is replaced wholesale rather than merged, so the caller's list is the
 * complete answer to "who can see this" — a merge would make removing someone
 * require a separate call that is easy to forget.
 */
export async function setVisibility(
  user: SessionUser,
  photoId: string,
  input: SetVisibilityInput,
): Promise<WriteResult> {
  const needsPrincipals = input.visibility === 'group' || input.visibility === 'selected';
  const principalIds = [...new Set(input.principalIds ?? [])];

  const outcome = await db.transaction(async (tx) => {
    const photo = await loadForWrite(tx, user, photoId);
    if (!photo) return { ok: false as const, reason: 'not_found' as const };

    if (needsPrincipals) {
      const valid = await validatePrincipals(tx, photo.batchId, input.visibility, principalIds);
      if (!valid) return { ok: false as const, reason: 'invalid_principal' as const };
    }

    await tx
      .update(schema.photos)
      .set({ visibility: input.visibility, updatedAt: new Date() })
      .where(eq(schema.photos.id, photoId));

    // Always clear: moving to `batch` or `private` must not leave stale grants
    // behind that would take effect again if the photo were later set back.
    await tx.delete(schema.photoAcl).where(eq(schema.photoAcl.photoId, photoId));

    if (needsPrincipals) {
      await tx.insert(schema.photoAcl).values(
        principalIds.map((principalId) => ({
          photoId,
          principalType: input.visibility === 'group' ? ('group' as const) : ('user' as const),
          principalId,
          grantedBy: user.id,
        })),
      );
    }

    return { ok: true as const, previous: photo.visibility };
  });

  if (!outcome.ok) return outcome;

  await audit({
    action: AuditAction.PHOTO_VISIBILITY_CHANGED,
    actorId: user.id,
    actorEmail: user.email,
    targetType: 'photo',
    targetId: photoId,
    metadata: {
      from: outcome.previous,
      to: input.visibility,
      principalCount: needsPrincipals ? principalIds.length : 0,
      // Record who was granted access, not just how many — an audit line saying
      // "shared with 3 people" cannot answer the question anyone will actually ask.
      principals: needsPrincipals ? principalIds : [],
    },
  });

  return { ok: true };
}

export type MetadataPatch = {
  caption?: string | null;
  academicYear?: string | null;
  semester?: string | null;
  eventId?: string | null;
  locationText?: string | null;
  campusZone?: 'campus' | 'hostel' | 'off_campus' | 'unknown';
  takenAt?: Date;
};

/** Edit descriptive metadata. Does not touch visibility — that is `setVisibility`. */
export async function updateMetadata(
  user: SessionUser,
  photoId: string,
  patch: MetadataPatch,
): Promise<WriteResult> {
  const outcome = await db.transaction(async (tx) => {
    const photo = await loadForWrite(tx, user, photoId);
    if (!photo) return { ok: false as const, reason: 'not_found' as const };

    if (patch.eventId) {
      if (!/^[0-9a-f-]{36}$/i.test(patch.eventId)) {
        return { ok: false as const, reason: 'invalid_principal' as const };
      }
      const [event] = await tx
        .select({ id: schema.events.id })
        .from(schema.events)
        .where(and(eq(schema.events.id, patch.eventId), eq(schema.events.batchId, photo.batchId)))
        .limit(1);
      if (!event) return { ok: false as const, reason: 'invalid_principal' as const };
    }

    await tx
      .update(schema.photos)
      .set({
        // Trimmed and length-capped; the column is free text that ends up in the
        // search vector and on screen.
        ...(patch.caption !== undefined && { caption: patch.caption?.slice(0, 2000) ?? null }),
        ...(patch.academicYear !== undefined && {
          academicYear: patch.academicYear?.slice(0, 40) ?? null,
        }),
        ...(patch.semester !== undefined && { semester: patch.semester?.slice(0, 40) ?? null }),
        ...(patch.eventId !== undefined && { eventId: patch.eventId }),
        ...(patch.locationText !== undefined && {
          locationText: patch.locationText?.slice(0, 200) ?? null,
        }),
        ...(patch.campusZone !== undefined && { campusZone: patch.campusZone }),
        ...(patch.takenAt !== undefined && { takenAt: patch.takenAt }),
        updatedAt: new Date(),
      })
      .where(eq(schema.photos.id, photoId));

    return { ok: true as const };
  });

  return outcome.ok ? { ok: true } : outcome;
}

/**
 * Soft delete.
 *
 * The photo disappears from every read immediately — the predicate already excludes
 * `deleted_at IS NOT NULL`, including for its own uploader. Recovery runs through
 * `restorePhoto` until `purge_after`, after which the sweep removes it for good.
 *
 * Deliberately not a hard delete: the common case is someone removing a photo they
 * did not mean to, and an archive spanning four years should not make that
 * unrecoverable.
 */
export async function softDeletePhoto(
  user: SessionUser,
  photoId: string,
): Promise<WriteResultWith<{ purgeAfter: Date }>> {
  const purgeAfter = new Date(Date.now() + env.DELETED_RETENTION_DAYS * 86_400_000);

  const outcome = await db.transaction(async (tx) => {
    const photo = await loadForWrite(tx, user, photoId);
    if (!photo) return { ok: false as const, reason: 'not_found' as const };

    await tx
      .update(schema.photos)
      .set({ deletedAt: new Date(), deletedBy: user.id, purgeAfter, updatedAt: new Date() })
      .where(eq(schema.photos.id, photoId));

    return { ok: true as const };
  });

  if (!outcome.ok) return outcome;

  await audit({
    action: AuditAction.PHOTO_DELETED,
    actorId: user.id,
    actorEmail: user.email,
    targetType: 'photo',
    targetId: photoId,
    metadata: { purgeAfter: purgeAfter.toISOString() },
  });

  return { ok: true, value: { purgeAfter } };
}

/** Undo a soft delete, provided the purge window has not closed. */
export async function restorePhoto(user: SessionUser, photoId: string): Promise<WriteResult> {
  const outcome = await db.transaction(async (tx) => {
    const photo = await loadForWrite(tx, user, photoId, { includeDeleted: true });
    if (!photo) return { ok: false as const, reason: 'not_found' as const };
    if (!photo.deletedAt) return { ok: false as const, reason: 'not_deleted' as const };

    // Once the sweep has run the objects are gone, so a row alone cannot be restored
    // into anything usable. Say so rather than resurrecting a broken record.
    if (photo.purgeAfter && photo.purgeAfter.getTime() < Date.now()) {
      return { ok: false as const, reason: 'purge_window_passed' as const };
    }

    await tx
      .update(schema.photos)
      .set({ deletedAt: null, deletedBy: null, purgeAfter: null, updatedAt: new Date() })
      .where(eq(schema.photos.id, photoId));

    return { ok: true as const };
  });

  if (!outcome.ok) return outcome;

  await audit({
    action: AuditAction.PHOTO_RESTORED,
    actorId: user.id,
    actorEmail: user.email,
    targetType: 'photo',
    targetId: photoId,
  });

  return { ok: true };
}

/**
 * Apply one operation across many photos.
 *
 * Each id is authorized on its own and reported on its own: a batch containing one
 * photo the caller may not touch does not fail the whole request, and — importantly —
 * the per-id result never distinguishes "not yours" from "does not exist", so a bulk
 * call cannot be used to enumerate the archive faster than a single one could.
 */
export const MAX_BULK_IDS = 500;

export type BulkOutcome = { id: string; ok: boolean; reason?: WriteFailure };

export async function bulkApply(
  user: SessionUser,
  photoIds: string[],
  apply: (photoId: string) => Promise<AnyWriteResult>,
): Promise<BulkOutcome[]> {
  const ids = [...new Set(photoIds)].slice(0, MAX_BULK_IDS);

  // Sequential rather than parallel: each call opens a transaction, and firing 500
  // at once would exhaust the connection pool for everyone else on the instance.
  const outcomes: BulkOutcome[] = [];
  for (const id of ids) {
    const result = await apply(id);
    outcomes.push(result.ok ? { id, ok: true } : { id, ok: false, reason: result.reason });
  }
  return outcomes;
}

/** Count how many photos in the batch are soft-deleted and still recoverable. */
export async function countRecoverable(user: SessionUser): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.photos)
    .where(
      and(
        eq(schema.photos.batchId, user.batchId),
        sql`${schema.photos.deletedAt} IS NOT NULL`,
        sql`${schema.photos.purgeAfter} > now()`,
        hasRole(user, 'admin') ? undefined : eq(schema.photos.uploaderId, user.id),
      ),
    );

  return row?.count ?? 0;
}

export type DeletedPhoto = {
  id: string;
  caption: string | null;
  takenAt: string;
  deletedAt: string;
  purgeAfter: string;
  uploaderName: string;
  isMine: boolean;
};

/**
 * Photos in the recovery window, for the trash screen.
 *
 * This reads the base table rather than `visible_photos`, because the view hides
 * soft-deleted rows by design. The write rule is applied instead — a member sees
 * only what they themselves deleted, an admin sees the whole batch — so this is not
 * a way around the visibility model but the same uploader-or-admin rule the restore
 * path already enforces.
 *
 * Rows past `purge_after` are excluded: the sweep may not have run yet, but they are
 * no longer restorable, and offering a button that cannot work is worse than
 * omitting the row.
 */
export async function listDeleted(user: SessionUser): Promise<DeletedPhoto[]> {
  const rows = await db
    .select({
      id: schema.photos.id,
      caption: schema.photos.caption,
      takenAt: schema.photos.takenAt,
      createdAt: schema.photos.createdAt,
      deletedAt: schema.photos.deletedAt,
      purgeAfter: schema.photos.purgeAfter,
      uploaderId: schema.photos.uploaderId,
      uploaderName: schema.users.displayName,
    })
    .from(schema.photos)
    .innerJoin(schema.users, eq(schema.users.id, schema.photos.uploaderId))
    .where(
      and(
        eq(schema.photos.batchId, user.batchId),
        sql`${schema.photos.deletedAt} IS NOT NULL`,
        sql`${schema.photos.purgeAfter} > now()`,
        hasRole(user, 'admin') ? undefined : eq(schema.photos.uploaderId, user.id),
      ),
    )
    .orderBy(sql`${schema.photos.deletedAt} DESC`)
    .limit(500);

  return rows.map((r) => ({
    id: r.id,
    caption: r.caption,
    // `taken_at` is null when the file carried no usable EXIF date; the upload time
    // is the only date we honestly have for those.
    takenAt: (r.takenAt ?? r.createdAt).toISOString(),
    deletedAt: r.deletedAt!.toISOString(),
    purgeAfter: r.purgeAfter!.toISOString(),
    uploaderName: r.uploaderName,
    isMine: r.uploaderId === user.id,
  }));
}
