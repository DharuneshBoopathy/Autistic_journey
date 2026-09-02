import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { failureStatus, json, requireApiUser } from '@/lib/api';
import { hasRole } from '@/lib/auth';
import { createInvite, revokeInvite } from '@/lib/invites';

export const runtime = 'nodejs';

/**
 * Issued invites. The codes themselves are NOT returned — only their hashes are
 * stored, and the plaintext exists exactly once, in the response that created it.
 * An admin who loses a code revokes it and issues another.
 */
export async function GET() {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;
  if (!hasRole(auth.user, 'admin')) return json({ error: 'Not found.' }, { status: 404 });

  const rows = await db
    .select({
      id: schema.invites.id,
      email: schema.invites.email,
      roleGranted: schema.invites.roleGranted,
      expiresAt: schema.invites.expiresAt,
      maxUses: schema.invites.maxUses,
      useCount: schema.invites.useCount,
      revokedAt: schema.invites.revokedAt,
      createdAt: schema.invites.createdAt,
    })
    .from(schema.invites)
    .where(eq(schema.invites.batchId, auth.user.batchId))
    .orderBy(desc(schema.invites.createdAt))
    .limit(200);

  return json({ invites: rows });
}

const createSchema = z.object({
  email: z.string().email().max(320).nullable().optional(),
  roleGranted: z.enum(['member', 'moderator', 'admin']).optional(),
  expiresInDays: z.number().int().min(1).max(90).optional(),
  maxUses: z.number().int().min(1).max(100).optional(),
});

export async function POST(request: Request) {
  const auth = await requireApiUser({ mutating: true });
  if (auth.error) return auth.error;
  if (!hasRole(auth.user, 'admin')) return json({ error: 'Not found.' }, { status: 404 });

  const body = createSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return json({ error: 'Invalid request.' }, { status: 400 });

  const invite = await createInvite({
    batchId: auth.user.batchId,
    createdBy: auth.user.id,
    email: body.data.email ?? null,
    roleGranted: body.data.roleGranted,
    expiresInDays: body.data.expiresInDays,
    maxUses: body.data.maxUses,
  });

  // The only time the plaintext code is ever available.
  return json(
    { id: invite.id, code: invite.code, expiresAt: invite.expiresAt.toISOString() },
    { status: 201 },
  );
}

const revokeSchema = z.object({ inviteId: z.string().regex(/^[0-9a-f-]{36}$/i) });

export async function DELETE(request: Request) {
  const auth = await requireApiUser({ mutating: true });
  if (auth.error) return auth.error;
  if (!hasRole(auth.user, 'admin')) return json({ error: 'Not found.' }, { status: 404 });

  const body = revokeSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return json({ error: 'Invalid request.' }, { status: 400 });

  // Scoped to the admin's own batch, so an id from elsewhere cannot be revoked.
  const [invite] = await db
    .select({ id: schema.invites.id })
    .from(schema.invites)
    .where(
      and(
        eq(schema.invites.id, body.data.inviteId),
        eq(schema.invites.batchId, auth.user.batchId),
      ),
    )
    .limit(1);

  if (!invite) return json({ error: 'Not found.' }, { status: failureStatus('not_found') });

  const revoked = await revokeInvite(body.data.inviteId, auth.user.id);
  return json({ ok: revoked });
}
