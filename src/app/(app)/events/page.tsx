import type { Metadata } from 'next';
import { hasRole, requireUser } from '@/lib/auth';
import { listEvents } from '@/lib/taxonomy';
import { Masthead, ui } from '@/components/ui';
import { Events } from './events';

export const metadata: Metadata = { title: 'Events — The Autistic Journey' };
export const dynamic = 'force-dynamic';

export default async function EventsPage() {
  const user = await requireUser();
  const events = await listEvents(user);

  return (
    <div className={ui.pageNarrow}>
      <Masthead
        eyebrow="Occasions"
        title="Events"
        lede="Fests, trips, farewells — the occasions photos get filed under. Anyone can add one; the counts show only what you are permitted to see, so two people looking at the same event will not always see the same number."
      />

      <Events events={events} canDelete={hasRole(user, 'admin')} />
    </div>
  );
}
