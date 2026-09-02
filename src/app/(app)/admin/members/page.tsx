import type { Metadata } from 'next';
import { requireRole } from '@/lib/auth';
import { listMembers } from '@/lib/admin';
import { Empty, Masthead } from '@/components/ui';
import { MemberList } from './member-actions';

export const metadata: Metadata = { title: 'Members — The Autistic Journey' };
export const dynamic = 'force-dynamic';

export default async function MembersPage() {
  const user = await requireRole('admin');
  const members = await listMembers(user);

  return (
    <>
      <Masthead
        eyebrow="Administration"
        title="Members"
        lede="Suspending an account ends every session it holds immediately, not at the next expiry. Reinstating it does not restore those sessions — the person signs in again."
      />

      {!members.ok || members.value.length === 0 ? (
        <Empty title="No members">Nobody has joined this batch yet.</Empty>
      ) : (
        <MemberList members={members.value} selfId={user.id} />
      )}
    </>
  );
}
