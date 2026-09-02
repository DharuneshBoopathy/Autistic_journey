import 'server-only';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { AuditAction, audit } from '@/lib/audit';
import { hasRole } from '@/lib/auth';
import type { SessionUser } from '@/lib/session';

/**
 * Time-limited, single-use permission for one member to download one original.
 *
 * The default remains "view is not download": members receive derivatives, and
 * originals are admin-only. This is the documented exception — someone needs the
 * full-resolution file of one specific photo — made explicit, narrow and expiring
 * rather than handled by quietly promoting them to admin, which is what happens when
 * a product has no mechanism for it.
 *
 * A grant is deliberately *not* how admins download. Their role already authorises
 * that, and requiring them to mint a grant for themselves would make the table a
 * log of ceremony rather than a record of exceptions.
 */

export type GrantFailure = 'not_found' | 'forbidden' | 'invalid';
export type GrantResult<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; reason: GrantFailure };

const uuidish = /^[0-9a-f-]{36}$/i;
const DEFAULT_TTL_MINUTES = 60;
const MAX_TTL_MINUTES = 60 * 24 * 7;

export async function issueDownloadGrant(
  admin: SessionUser,
  input: { photoId: string; userId: string; reason?: string; expiresInMinutes?: number },
): Promise<GrantResult<{ id: string; expiresAt: Date }>> {
  if (!hasRole(admin, 'admin')) return { ok: false, reason: 'forbidden' };
  if (!uuidish.test(input.photoId) || !uuidish.test(input.userId)) {
    return { ok: false, reason: 'not_found' };
  }

  const ttl = Math.min(Math.max(input.expiresInMinutes ?? DEFAULT_TTL_MINUTES, 1), MAX_TTL_MINUTES);
  const expiresAt = new Date(Date.now() + ttl * 60_000);

  const outcome = await db.transaction(async (tx) => {
    // Both the photo and the recipient must belong to the admin's own batch.
    const [photo] = await tx
      .select({ id: schema.photos.id })
      .from(schema.photos)
      .where(
        and(
          eq(schema.photos.id, input.photoId),
          eq(schema.photos.batchId, admin.batchId),
          isNull(schema.photos.deletedAt),
        ),
      )
      .limit(1);

    if (!photo) return { ok: false as const, reason: 'not_found' as const };

    const [recipient] = await tx
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .where(
        and(
          eq(schema.users.id, input.userId),
          eq(schema.users.batchId, admin.batchId),
          eq(schema.users.status, 'active'),
        ),
      )
      .limit(1);

    if (!recipient) return { ok: false as const, reason: 'invalid' as const };

    const [grant] = await tx
      .insert(schema.downloadGrants)
      .values({
        photoId: input.photoId,
        userId: input.userId,
        issuedBy: admin.id,
        reason: input.reason?.slice(0, 500) ?? null,
        expiresAt,
      })
      .returning({ id: schema.downloadGrants.id });

    return { ok: true as const, id: grant!.id, email: recipient.email };
  });

  if (!outcome.ok) return outcome;

  await audit({
    action: AuditAction.DOWNLOAD_GRANT_ISSUED,
    actorId: admin.id,
    actorEmail: admin.email,
    targetType: 'photo',
    targetId: input.photoId,
    metadata: {
      grantId: outcome.id,
      recipient: outcome.email,
      reason: input.reason ?? null,
      expiresAt: expiresAt.toISOString(),
    },
  });

  return { ok: true, value: { id: outcome.id, expiresAt } };
}

/**
 * Atomically consume a grant, if this viewer holds a live one for this photo.
 *
 * The check and the consumption are one UPDATE. A separate SELECT then UPDATE would
 * let two concurrent requests both observe an unused grant and both download — which
 * is precisely what "single use" is supposed to prevent.
 */
export async function consumeDownloadGrant(
  user: SessionUser,
  photoId: string,
): Promise<boolean> {
  if (!uuidish.test(photoId)) return false;

  const rows = await db.execute<{ id: string }>(sql`
    UPDATE download_grants
       SET used_at = now()
     WHERE id = (
       SELECT id FROM download_grants
        WHERE photo_id = ${photoId}::uuid
          AND user_id  = ${user.id}::uuid
          AND used_at IS NULL
          AND expires_at > now()
        ORDER BY expires_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED
     )
    RETURNING id
  `);

  return Array.from(rows).length > 0;
}

export type GrantRow = {
  id: string;
  photoId: string;
  recipient: string;
  issuedBy: string | null;
  reason: string | null;
  expiresAt: string;
  usedAt: string | null;
};

export async function listGrants(admin: SessionUser): Promise<GrantResult<GrantRow[]>> {
  if (!hasRole(admin, 'admin')) return { ok: false, reason: 'forbidden' };

  const rows = await db.execute<{
    id: string;
    photo_id: string;
    recipient: string;
    issued_by: string | null;
    reason: string | null;
    expires_at: string;
    used_at: string | null;
  }>(sql`
    SELECT g.id, g.photo_id, r.display_name AS recipient, i.display_name AS issued_by,
           g.reason, g.expires_at, g.used_at
      FROM download_grants g
      JOIN users r ON r.id = g.user_id
      LEFT JOIN users i ON i.id = g.issued_by
     WHERE r.batch_id = ${admin.batchId}::uuid
     ORDER BY g.created_at DESC
     LIMIT 200
  `);

  return {
    ok: true,
    value: Array.from(rows).map((r) => ({
      id: r.id,
      photoId: r.photo_id,
      recipient: r.recipient,
      issuedBy: r.issued_by,
      reason: r.reason,
      expiresAt: new Date(r.expires_at).toISOString(),
      usedAt: r.used_at ? new Date(r.used_at).toISOString() : null,
    })),
  };
}
