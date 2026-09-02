import type { Metadata } from 'next';
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { requireRole } from '@/lib/auth';
import { Masthead } from '@/components/ui';
import { Invites } from './invites';

export const metadata: Metadata = { title: 'Invites — The Autistic Journey' };
export const dynamic = 'force-dynamic';

export default async function InvitesPage() {
  const user = await requireRole('admin');

  // Read here rather than from an effect in the browser: the list is already
  // admin-only, and fetching it on the server means the page arrives complete.
  // Note what is *not* selected — `code_hash`. The plaintext code exists exactly
  // once, in the response that created it, and never afterwards.
  const invites = await db
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
    .where(eq(schema.invites.batchId, user.batchId))
    .orderBy(desc(schema.invites.createdAt))
    .limit(200);

  return (
    <>
      <Masthead
        eyebrow="Administration"
        title="Invites"
        lede="An invite code lets someone register; an admin still has to approve the account afterwards. Only a hash of each code is stored, so a code is shown exactly once, when it is created."
      />
      <Invites
        invites={invites.map((invite) => ({
          ...invite,
          expiresAt: invite.expiresAt.toISOString(),
          revokedAt: invite.revokedAt?.toISOString() ?? null,
          createdAt: invite.createdAt.toISOString(),
        }))}
      />
    </>
  );
}
