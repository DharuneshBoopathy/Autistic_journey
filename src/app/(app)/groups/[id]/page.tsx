import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { listGroupMembers, listGroups } from '@/lib/groups';
import { Masthead, ui } from '@/components/ui';
import { GroupMembers } from './group-members';

export const metadata: Metadata = { title: 'Group — The Autistic Journey' };
export const dynamic = 'force-dynamic';

export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const [groups, members] = await Promise.all([listGroups(user), listGroupMembers(user, id)]);
  const group = groups.find((g) => g.id === id);

  if (!group || !members.ok) notFound();

  return (
    <div className={ui.pageNarrow}>
      <Masthead
        eyebrow="Group"
        title={group.name}
        lede={
          group.description ?? (
            <>
              Everyone here can see photos shared with this group. Removing someone takes that
              access away on their next request, not at the end of their session.
            </>
          )
        }
        actions={
          <Link href="/groups" className={`${ui.button} ${ui.buttonQuiet}`}>
            All groups
          </Link>
        }
      />

      <GroupMembers
        groupId={group.id}
        canManage={group.viewerCanManage}
        isOwner={group.ownerId === user.id}
        initialMembers={members.value}
      />
    </div>
  );
}
