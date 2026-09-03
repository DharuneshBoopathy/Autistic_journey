import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import { listSessions } from '@/lib/account';
import { Masthead, Section, ui } from '@/components/ui';
import { ChangePassword } from './change-password';
import { Sessions } from './sessions';

export const metadata: Metadata = { title: 'Your account — The Autistic Journey' };
export const dynamic = 'force-dynamic';

const ROLE_LABEL: Record<string, string> = {
  member: 'Member',
  moderator: 'Moderator',
  admin: 'Administrator',
};

export default async function AccountPage() {
  const user = await requireUser();
  const { sessions, total } = await listSessions(user);

  return (
    <div className={ui.pageNarrow}>
      <Masthead
        eyebrow="Your account"
        title={user.displayName}
        lede={
          <>
            {user.email} · {ROLE_LABEL[user.role]} of this batch. Your name and email are set when
            the account is approved; ask an admin to change either.
          </>
        }
      />

      <Section title="Password">
        <ChangePassword />
      </Section>

      <Section
        title="Where you are signed in"
        aside={<span className={ui.listMeta}>{total}</span>}
      >
        <Sessions initial={sessions} total={total} />
      </Section>
    </div>
  );
}
