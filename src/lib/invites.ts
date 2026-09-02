import 'server-only';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, schema, type Tx } from '@/db';
import { generateInviteCode, hashToken, normalizeEmail, normalizeInviteCode } from '@/lib/tokens';
import { AuditAction, audit } from '@/lib/audit';
import type { Role } from '@/lib/auth';

export type CreateInviteInput = {
  batchId: string;
  createdBy: string;
  email?: string | null;
  roleGranted?: Role;
  expiresInDays?: number;
  maxUses?: number;
};

export type CreatedInvite = { id: string; code: string; expiresAt: Date };

/**
 * Mint an invite.
 *
 * The plaintext code is returned exactly once, here, and never stored — only its
 * SHA-256 goes to the database. An admin who loses the code revokes it and issues a
 * new one; there is no "show me that code again", by design.
 */
export async function createInvite(input: CreateInviteInput): Promise<CreatedInvite> {
  const code = generateInviteCode();
  const expiresAt = new Date(Date.now() + (input.expiresInDays ?? 14) * 86_400_000);

  const [row] = await db
    .insert(schema.invites)
    .values({
      codeHash: hashToken(normalizeInviteCode(code)),
      batchId: input.batchId,
      email: input.email ? normalizeEmail(input.email) : null,
      roleGranted: input.roleGranted ?? 'member',
      createdBy: input.createdBy,
      expiresAt,
      maxUses: input.maxUses ?? 1,
    })
    .returning({ id: schema.invites.id });

  await audit({
    action: AuditAction.INVITE_CREATED,
    actorId: input.createdBy,
    targetType: 'invite',
    targetId: row!.id,
    metadata: {
      boundToEmail: input.email ? normalizeEmail(input.email) : null,
      roleGranted: input.roleGranted ?? 'member',
      maxUses: input.maxUses ?? 1,
      expiresAt: expiresAt.toISOString(),
    },
  });

  return { id: row!.id, code, expiresAt };
}

export type RedeemFailure =
  | 'invalid'
  | 'expired'
  | 'revoked'
  | 'exhausted'
  | 'email_mismatch';

export type RedeemedInvite = {
  id: string;
  batchId: string;
  roleGranted: Role;
};

/**
 * Atomically validate and consume one use of an invite.
 *
 * The whole thing is a single conditional UPDATE. Doing it as SELECT-then-UPDATE
 * would let two concurrent redemptions of a single-use code both observe
 * `use_count = 0` and both proceed; the `use_count < max_uses` predicate inside the
 * UPDATE makes that race impossible, because only one statement can win the row.
 *
 * Must be called inside the same transaction that creates the user, so a failure
 * during account creation does not silently burn the invite.
 */
export async function redeemInvite(
  tx: Tx,
  rawCode: string,
  email: string,
): Promise<{ ok: true; invite: RedeemedInvite } | { ok: false; reason: RedeemFailure }> {
  const codeHash = hashToken(normalizeInviteCode(rawCode));

  const [found] = await tx
    .select({
      id: schema.invites.id,
      batchId: schema.invites.batchId,
      email: schema.invites.email,
      roleGranted: schema.invites.roleGranted,
      expiresAt: schema.invites.expiresAt,
      revokedAt: schema.invites.revokedAt,
      maxUses: schema.invites.maxUses,
      useCount: schema.invites.useCount,
    })
    .from(schema.invites)
    .where(eq(schema.invites.codeHash, codeHash))
    .limit(1);

  if (!found) return { ok: false, reason: 'invalid' };
  if (found.revokedAt) return { ok: false, reason: 'revoked' };
  if (found.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'expired' };
  if (found.email && found.email !== normalizeEmail(email)) {
    return { ok: false, reason: 'email_mismatch' };
  }

  // The atomic consume. If another request took the last use between the read above
  // and this statement, no row matches and we report exhaustion.
  const consumed = await tx
    .update(schema.invites)
    .set({ useCount: sql`${schema.invites.useCount} + 1` })
    .where(
      and(
        eq(schema.invites.id, found.id),
        isNull(schema.invites.revokedAt),
        sql`${schema.invites.useCount} < ${schema.invites.maxUses}`,
        sql`${schema.invites.expiresAt} > now()`,
      ),
    )
    .returning({ id: schema.invites.id });

  if (consumed.length === 0) return { ok: false, reason: 'exhausted' };

  return {
    ok: true,
    invite: { id: found.id, batchId: found.batchId, roleGranted: found.roleGranted },
  };
}

export async function revokeInvite(inviteId: string, actorId: string): Promise<boolean> {
  const revoked = await db
    .update(schema.invites)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.invites.id, inviteId), isNull(schema.invites.revokedAt)))
    .returning({ id: schema.invites.id });

  if (revoked.length > 0) {
    await audit({
      action: AuditAction.INVITE_REVOKED,
      actorId,
      targetType: 'invite',
      targetId: inviteId,
    });
  }

  return revoked.length > 0;
}
