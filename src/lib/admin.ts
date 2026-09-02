import 'server-only';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { AuditAction, audit } from '@/lib/audit';
import { hasRole, type Role } from '@/lib/auth';
import { getStorageUsage, type StorageUsage } from '@/lib/quota';
import { revokeAllSessions } from '@/lib/session';
import type { SessionUser } from '@/lib/session';

/**
 * Administration.
 *
 * These are the paths the `visible_photos` COMMENT refers to when it permits reading
 * the base table directly. Everything here is admin-gated at the route and audited,
 * because an administrator can see and do things no member can, and the point of the
 * audit log is that this remains answerable afterwards.
 *
 * Note what is deliberately absent: there is no "admin browses every photo" listing.
 * Moderation acts on a photo someone reported or an id an admin already holds; a
 * general-purpose window onto every private photo in the archive would make the
 * visibility model advisory, and no operational need requires it.
 */

export type AdminFailure = 'not_found' | 'forbidden' | 'invalid';
export type AdminResult<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; reason: AdminFailure };

const uuidish = /^[0-9a-f-]{36}$/i;

function assertAdmin(user: SessionUser): boolean {
  return hasRole(user, 'admin');
}

// --- Members ------------------------------------------------------------------

export type MemberRow = {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  status: string;
  createdAt: string;
  lastLoginAt: string | null;
  photoCount: number;
};

export async function listMembers(
  user: SessionUser,
  filter: { status?: string } = {},
): Promise<AdminResult<MemberRow[]>> {
  if (!assertAdmin(user)) return { ok: false, reason: 'forbidden' };

  const rows = await db.execute<{
    id: string;
    email: string;
    display_name: string;
    role: Role;
    status: string;
    created_at: string;
    last_login_at: string | null;
    photo_count: string;
  }>(sql`
    SELECT u.id, u.email, u.display_name, u.role, u.status, u.created_at, u.last_login_at,
           (SELECT count(*) FROM photos p WHERE p.uploader_id = u.id) AS photo_count
      FROM users u
     WHERE u.batch_id = ${user.batchId}::uuid
       ${filter.status ? sql`AND u.status = ${filter.status}::user_status` : sql``}
     ORDER BY
       -- Pending accounts first: they are the queue an admin is here to work.
       CASE WHEN u.status = 'pending' THEN 0 ELSE 1 END,
       u.created_at DESC
  `);

  return {
    ok: true,
    value: Array.from(rows).map((r) => ({
      id: r.id,
      email: r.email,
      displayName: r.display_name,
      role: r.role,
      status: r.status,
      createdAt: new Date(r.created_at).toISOString(),
      lastLoginAt: r.last_login_at ? new Date(r.last_login_at).toISOString() : null,
      photoCount: Number(r.photo_count),
    })),
  };
}

/** Load a member of the admin's own batch. Admins cannot reach across batches. */
async function loadMember(user: SessionUser, memberId: string) {
  if (!uuidish.test(memberId)) return null;

  const [row] = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      status: schema.users.status,
      role: schema.users.role,
    })
    .from(schema.users)
    .where(and(eq(schema.users.id, memberId), eq(schema.users.batchId, user.batchId)))
    .limit(1);

  return row ?? null;
}

export async function approveMember(
  user: SessionUser,
  memberId: string,
): Promise<AdminResult> {
  if (!assertAdmin(user)) return { ok: false, reason: 'forbidden' };

  const member = await loadMember(user, memberId);
  if (!member) return { ok: false, reason: 'not_found' };
  if (member.status !== 'pending') return { ok: false, reason: 'invalid' };

  await db
    .update(schema.users)
    .set({ status: 'active', approvedBy: user.id, approvedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.users.id, memberId));

  await audit({
    action: AuditAction.USER_APPROVED,
    actorId: user.id,
    actorEmail: user.email,
    targetType: 'user',
    targetId: memberId,
    metadata: { email: member.email },
  });

  return { ok: true, value: undefined };
}

export async function rejectMember(user: SessionUser, memberId: string): Promise<AdminResult> {
  if (!assertAdmin(user)) return { ok: false, reason: 'forbidden' };

  const member = await loadMember(user, memberId);
  if (!member) return { ok: false, reason: 'not_found' };
  if (member.status !== 'pending') return { ok: false, reason: 'invalid' };

  // Deactivated rather than deleted: the row is the record that this request was
  // made and refused, and deleting it would also fail against uploads if any exist.
  await db
    .update(schema.users)
    .set({ status: 'deactivated', deactivatedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.users.id, memberId));

  await audit({
    action: AuditAction.USER_REJECTED,
    actorId: user.id,
    actorEmail: user.email,
    targetType: 'user',
    targetId: memberId,
    metadata: { email: member.email },
  });

  return { ok: true, value: undefined };
}

export async function setMemberStatus(
  user: SessionUser,
  memberId: string,
  status: 'active' | 'suspended',
): Promise<AdminResult> {
  if (!assertAdmin(user)) return { ok: false, reason: 'forbidden' };

  const member = await loadMember(user, memberId);
  if (!member) return { ok: false, reason: 'not_found' };

  // An admin locking themselves out mid-session is a support call, not a security
  // control. Refuse rather than allow it and hope somebody else has access.
  if (memberId === user.id && status === 'suspended') {
    return { ok: false, reason: 'invalid' };
  }

  await db
    .update(schema.users)
    .set({ status, deactivatedAt: null, updatedAt: new Date() })
    .where(eq(schema.users.id, memberId));

  let revoked = 0;
  if (status === 'suspended') {
    // Suspension takes effect now. The session lookup would refuse them anyway on
    // the next request, but revoking makes the intent explicit and leaves a count in
    // the audit record.
    revoked = await revokeAllSessions(memberId);
  }

  await audit({
    action: status === 'suspended' ? AuditAction.USER_SUSPENDED : AuditAction.USER_REINSTATED,
    actorId: user.id,
    actorEmail: user.email,
    targetType: 'user',
    targetId: memberId,
    metadata: { email: member.email, sessionsRevoked: revoked },
  });

  return { ok: true, value: undefined };
}

export async function setMemberRole(
  user: SessionUser,
  memberId: string,
  role: Role,
): Promise<AdminResult> {
  if (!assertAdmin(user)) return { ok: false, reason: 'forbidden' };

  const member = await loadMember(user, memberId);
  if (!member) return { ok: false, reason: 'not_found' };

  // Same reasoning as suspension: an admin must not demote themselves into a state
  // where nobody can administer the archive.
  if (memberId === user.id && role !== 'admin') return { ok: false, reason: 'invalid' };

  await db
    .update(schema.users)
    .set({ role, updatedAt: new Date() })
    .where(eq(schema.users.id, memberId));

  await audit({
    action: AuditAction.USER_ROLE_CHANGED,
    actorId: user.id,
    actorEmail: user.email,
    targetType: 'user',
    targetId: memberId,
    metadata: { email: member.email, from: member.role, to: role },
  });

  return { ok: true, value: undefined };
}

// --- Operations ---------------------------------------------------------------

export type AdminStats = {
  storage: StorageUsage;
  photos: { ready: number; processing: number; uploading: number; failed: number; deleted: number };
  members: { active: number; pending: number; suspended: number; deactivated: number };
  jobs: { queued: number; running: number; failed: number };
};

export async function getStats(user: SessionUser): Promise<AdminResult<AdminStats>> {
  if (!assertAdmin(user)) return { ok: false, reason: 'forbidden' };

  const [storage, photoRows, memberRows, jobRows] = await Promise.all([
    getStorageUsage({ fresh: true }),
    db.execute<{ status: string; count: string; deleted: string }>(sql`
      SELECT status::text AS status, count(*) AS count,
             count(*) FILTER (WHERE deleted_at IS NOT NULL) AS deleted
        FROM photos WHERE batch_id = ${user.batchId}::uuid GROUP BY status`),
    db.execute<{ status: string; count: string }>(sql`
      SELECT status::text AS status, count(*) AS count
        FROM users WHERE batch_id = ${user.batchId}::uuid GROUP BY status`),
    db.execute<{ state: string; count: string }>(sql`
      SELECT state::text AS state, count(*) AS count FROM processing_jobs GROUP BY state`),
  ]);

  const photos = { ready: 0, processing: 0, uploading: 0, failed: 0, deleted: 0 };
  for (const row of Array.from(photoRows)) {
    if (row.status in photos) photos[row.status as keyof typeof photos] = Number(row.count);
    photos.deleted += Number(row.deleted);
  }

  const members = { active: 0, pending: 0, suspended: 0, deactivated: 0 };
  for (const row of Array.from(memberRows)) {
    if (row.status in members) members[row.status as keyof typeof members] = Number(row.count);
  }

  const jobs = { queued: 0, running: 0, failed: 0 };
  for (const row of Array.from(jobRows)) {
    if (row.state in jobs) jobs[row.state as keyof typeof jobs] = Number(row.count);
  }

  return { ok: true, value: { storage, photos, members, jobs } };
}

export type FailedPhoto = {
  id: string;
  originalFilename: string | null;
  uploaderName: string;
  error: string | null;
  attempts: number;
  uploadedAt: string;
};

/** Photos whose processing failed, so they can be retried rather than lost. */
export async function listFailures(user: SessionUser): Promise<AdminResult<FailedPhoto[]>> {
  if (!assertAdmin(user)) return { ok: false, reason: 'forbidden' };

  const rows = await db.execute<{
    id: string;
    original_filename: string | null;
    uploader_name: string;
    error: string | null;
    attempts: number | null;
    uploaded_at: string;
  }>(sql`
    SELECT p.id, p.original_filename, u.display_name AS uploader_name,
           coalesce(p.processing_error, j.last_error) AS error,
           j.attempts, p.uploaded_at
      FROM photos p
      JOIN users u ON u.id = p.uploader_id
      LEFT JOIN LATERAL (
        SELECT last_error, attempts FROM processing_jobs
         WHERE photo_id = p.id ORDER BY updated_at DESC LIMIT 1
      ) j ON TRUE
     WHERE p.batch_id = ${user.batchId}::uuid
       AND p.status = 'failed'
       AND p.deleted_at IS NULL
     ORDER BY p.uploaded_at DESC
     LIMIT 200
  `);

  return {
    ok: true,
    value: Array.from(rows).map((r) => ({
      id: r.id,
      originalFilename: r.original_filename,
      uploaderName: r.uploader_name,
      error: r.error,
      attempts: Number(r.attempts ?? 0),
      uploadedAt: new Date(r.uploaded_at).toISOString(),
    })),
  };
}

/** Re-queue a failed photo's derivative generation. */
export async function retryProcessing(
  user: SessionUser,
  photoId: string,
): Promise<AdminResult> {
  if (!assertAdmin(user)) return { ok: false, reason: 'forbidden' };
  if (!uuidish.test(photoId)) return { ok: false, reason: 'not_found' };

  const outcome = await db.transaction(async (tx) => {
    const [photo] = await tx
      .select({ id: schema.photos.id, originalKey: schema.photos.originalKey })
      .from(schema.photos)
      .where(and(eq(schema.photos.id, photoId), eq(schema.photos.batchId, user.batchId)))
      .limit(1);

    if (!photo) return { ok: false as const, reason: 'not_found' as const };
    // Without an original there is nothing to re-derive; retrying would only fail
    // again, more slowly.
    if (!photo.originalKey) return { ok: false as const, reason: 'invalid' as const };

    await tx
      .update(schema.photos)
      .set({ status: 'processing', processingError: null, updatedAt: new Date() })
      .where(eq(schema.photos.id, photoId));

    await tx.delete(schema.processingJobs).where(eq(schema.processingJobs.photoId, photoId));
    await tx.insert(schema.processingJobs).values({ photoId, kind: 'derivatives' });

    return { ok: true as const };
  });

  return outcome.ok ? { ok: true, value: undefined } : outcome;
}

export type AuditRow = {
  id: number;
  action: string;
  actorId: string | null;
  actorEmail: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

/**
 * Read the audit log. Admin only, paginated, newest first.
 *
 * Entries may reference accounts that no longer exist — `actor_id` is intentionally
 * not a foreign key — so the actor's address is read from the captured metadata
 * rather than by joining `users`.
 */
export async function readAuditLog(
  user: SessionUser,
  options: { action?: string; targetId?: string; before?: number; limit?: number } = {},
): Promise<AdminResult<AuditRow[]>> {
  if (!assertAdmin(user)) return { ok: false, reason: 'forbidden' };

  const limit = Math.min(options.limit ?? 100, 500);

  const rows = await db
    .select()
    .from(schema.auditLogs)
    .where(
      and(
        options.action ? eq(schema.auditLogs.action, options.action) : undefined,
        options.targetId ? eq(schema.auditLogs.targetId, options.targetId) : undefined,
        options.before ? sql`${schema.auditLogs.id} < ${options.before}` : undefined,
      ),
    )
    .orderBy(desc(schema.auditLogs.id))
    .limit(limit);

  return {
    ok: true,
    value: rows.map((r) => ({
      id: r.id,
      action: r.action,
      actorId: r.actorId,
      actorEmail:
        (r.metadata as Record<string, unknown> | null)?.actor as string | undefined ?? null,
      targetType: r.targetType,
      targetId: r.targetId,
      metadata: r.metadata as Record<string, unknown> | null,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}
