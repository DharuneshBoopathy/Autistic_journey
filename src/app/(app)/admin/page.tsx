import type { Metadata } from 'next';
import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { getStats, listMembers } from '@/lib/admin';
import { Badge, Empty, Masthead, Section, Stat, formatBytes, ui } from '@/components/ui';
import { PendingMembers } from './members/member-actions';

export const metadata: Metadata = { title: 'Admin — The Autistic Journey' };
export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const user = await requireRole('admin');
  const [stats, pending] = await Promise.all([
    getStats(user),
    listMembers(user, { status: 'pending' }),
  ]);

  if (!stats.ok) throw new Error('Statistics unavailable.');

  const { storage, photos, members, jobs } = stats.value;
  const percent = Math.min(100, Math.round(storage.fraction * 100));
  const meterTone =
    storage.fraction >= 0.95 ? ui.meterFull : storage.fraction >= 0.8 ? ui.meterWarn : '';

  return (
    <>
      <Masthead
        eyebrow="Administration"
        title="Overview"
        lede="Storage headroom, what the archive holds, and who is waiting to be let in."
      />

      <Section title="Storage">
        <div className={ui.statGrid}>
          <Stat
            label="Used"
            value={formatBytes(storage.totalBytes)}
            note={`of ${formatBytes(storage.quotaBytes)} allowed`}
          />
          <Stat
            label="Originals"
            value={formatBytes(storage.originalBytes)}
            note="kept, never served to members"
          />
          <Stat
            label="Previews"
            value={formatBytes(storage.derivativeBytes)}
            note="regenerable from the originals"
          />
          <Stat
            label="Headroom"
            value={formatBytes(Math.max(0, storage.remainingBytes))}
            note={`${storage.photoCount.toLocaleString()} photos stored`}
          />
        </div>

        <div className={ui.meter} role="img" aria-label={`${percent}% of the storage ceiling used`}>
          <div className={`${ui.meterFill} ${meterTone}`} style={{ width: `${percent}%` }} />
        </div>

        <p className={ui.hint}>
          {storage.fraction >= 1 ? (
            <>
              The ceiling has been reached and new uploads are being refused. Free space by
              emptying the trash, or raise <code className={ui.code}>STORAGE_SOFT_QUOTA_BYTES</code>{' '}
              once the storage behind it has actually been increased.
            </>
          ) : (
            <>
              This ceiling is a configured limit, set below the real one on purpose so uploads are
              refused with an explanation instead of failing somewhere in the provider. It is not a
              promise of unlimited space.
            </>
          )}
        </p>
      </Section>

      <Section title="The archive">
        <div className={ui.statGrid}>
          <Stat label="Ready" value={photos.ready.toLocaleString()} note="processed and visible" />
          <Stat label="Processing" value={photos.processing.toLocaleString()} note="in the queue" />
          <Stat
            label="Failed"
            value={photos.failed.toLocaleString()}
            note={photos.failed > 0 ? <Link href="/admin/failures">Look at these</Link> : 'none'}
          />
          <Stat label="In the trash" value={photos.deleted.toLocaleString()} note="recoverable" />
        </div>
      </Section>

      <Section title="Members and jobs">
        <div className={ui.statGrid}>
          <Stat label="Active" value={members.active.toLocaleString()} />
          <Stat label="Awaiting approval" value={members.pending.toLocaleString()} />
          <Stat label="Suspended" value={members.suspended.toLocaleString()} />
          <Stat
            label="Queue"
            value={`${jobs.queued} / ${jobs.running}`}
            note={jobs.failed > 0 ? `${jobs.failed} jobs failed` : 'queued / running'}
          />
        </div>
      </Section>

      <Section
        title="Waiting to be let in"
        aside={
          pending.ok && pending.value.length > 0 ? (
            <Badge tone="notice">{pending.value.length}</Badge>
          ) : undefined
        }
      >
        {!pending.ok || pending.value.length === 0 ? (
          <Empty title="Nobody waiting">
            Registrations with a valid invite code land here for approval before they can see
            anything.
          </Empty>
        ) : (
          <PendingMembers members={pending.value} />
        )}
      </Section>
    </>
  );
}
