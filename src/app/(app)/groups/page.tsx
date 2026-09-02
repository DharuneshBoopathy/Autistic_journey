import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { listGroups } from '@/lib/groups';
import { Badge, Empty, Masthead, ui } from '@/components/ui';
import { NewGroup } from './new-group';

export const metadata: Metadata = { title: 'Groups — The Autistic Journey' };
export const dynamic = 'force-dynamic';

export default async function GroupsPage() {
  const user = await requireUser();
  const groups = await listGroups(user);

  return (
    <div className={ui.page}>
      <Masthead
        eyebrow="People"
        title="Groups"
        lede="A group is a name for a set of people, used when sharing a photo. Being in a group does not give anyone access to anything on its own — only to photos already shared with that group."
        actions={<NewGroup />}
      />

      {groups.length === 0 ? (
        <Empty title="No groups yet">
          Make one for the people you share with most — a hostel floor, a project team, a
          circle of friends.
        </Empty>
      ) : (
        <div className={ui.list}>
          {groups.map((group) => (
            <div key={group.id} className={ui.listRow}>
              <div className={ui.listMain}>
                <div className={ui.listTitle}>
                  <Link href={`/groups/${group.id}`}>{group.name}</Link>
                </div>
                <div className={ui.listMeta}>
                  {group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}
                  {group.description ? ` · ${group.description}` : ''}
                </div>
              </div>

              {group.viewerIsMember && <Badge tone="success">You are in this</Badge>}
              {group.viewerCanManage && <Badge>You manage it</Badge>}

              <Link href={`/groups/${group.id}`} className={`${ui.button} ${ui.buttonSmall}`}>
                Open
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
