import type { Metadata } from 'next';
import { requireRole } from '@/lib/auth';
import { listFailures } from '@/lib/admin';
import { Empty, Masthead } from '@/components/ui';
import { Failures } from './failures';

export const metadata: Metadata = { title: 'Processing failures — The Autistic Journey' };
export const dynamic = 'force-dynamic';

export default async function FailuresPage() {
  const user = await requireRole('admin');
  const failures = await listFailures(user);

  return (
    <>
      <Masthead
        eyebrow="Administration"
        title="Processing failures"
        lede="Uploads whose previews could not be generated. The original is still stored, so a retry re-derives from it — nothing has been lost unless the upload itself never finished."
      />

      {!failures.ok || failures.value.length === 0 ? (
        <Empty title="Nothing failed">Every upload has been processed.</Empty>
      ) : (
        <Failures failures={failures.value} />
      )}
    </>
  );
}
