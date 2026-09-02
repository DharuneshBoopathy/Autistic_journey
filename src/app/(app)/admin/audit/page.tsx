import type { Metadata } from 'next';
import { requireRole } from '@/lib/auth';
import { readAuditLog } from '@/lib/admin';
import { Masthead } from '@/components/ui';
import { AuditLog } from './audit-log';

export const metadata: Metadata = { title: 'Audit log — The Autistic Journey' };
export const dynamic = 'force-dynamic';

export default async function AuditPage() {
  const user = await requireRole('admin');

  // The first page is read on the server so the log arrives with the document.
  // Filtering and paging happen from the client afterwards, through the same
  // admin-gated route.
  const first = await readAuditLog(user, { limit: 100 });

  return (
    <>
      <Masthead
        eyebrow="Administration"
        title="Audit log"
        lede="Every sign-in, approval, visibility change and download, newest first. The table is append-only — a database trigger rejects updates and deletes, so entries cannot be edited away, including by an admin."
      />
      <AuditLog initial={first.ok ? first.value : []} />
    </>
  );
}
