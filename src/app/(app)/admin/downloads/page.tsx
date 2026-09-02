import type { Metadata } from 'next';
import { requireRole } from '@/lib/auth';
import { listGrants } from '@/lib/download-grants';
import { Badge, Empty, Masthead, Section, ui } from '@/components/ui';

export const metadata: Metadata = { title: 'Download grants — The Autistic Journey' };
export const dynamic = 'force-dynamic';

const stamp = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * A grant that was never used before its window closed.
 *
 * "Now" is the moment the page is rendered, which for a server component is the
 * moment of the request — the same basis the grant route uses when it decides
 * whether to honour one.
 */
function isExpired(iso: string): boolean {
  return new Date(iso).getTime() < Date.now();
}

export default async function DownloadsPage() {
  const user = await requireRole('admin');
  const grants = await listGrants(user);

  return (
    <>
      <Masthead
        eyebrow="Administration"
        title="Download grants"
        lede="Members can view photos but never download the originals. A grant is the one documented exception: it lets one named person fetch one named original, once, before it expires — and every use is recorded."
      />

      <Section title="Issued grants">
        {!grants.ok || grants.value.length === 0 ? (
          <Empty title="No grants issued">
            Nobody has been given a copy of an original. Grants are created from a photo, so that
            the file being released is chosen deliberately rather than from a list of ids.
          </Empty>
        ) : (
          <div className={ui.list}>
            {grants.value.map((grant) => {
              const expired = isExpired(grant.expiresAt);

              return (
                <div key={grant.id} className={ui.listRow}>
                  <div className={ui.listMain}>
                    <div className={ui.listTitle}>{grant.recipient}</div>
                    <div className={ui.listMeta}>
                      issued by {grant.issuedBy ?? 'an account since removed'} · expires{' '}
                      {stamp.format(new Date(grant.expiresAt))}
                      {grant.reason ? ` · ${grant.reason}` : ''}
                    </div>
                  </div>

                  {grant.usedAt ? (
                    <Badge tone="neutral">used {stamp.format(new Date(grant.usedAt))}</Badge>
                  ) : expired ? (
                    <Badge tone="neutral">expired unused</Badge>
                  ) : (
                    <Badge tone="notice">outstanding</Badge>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </>
  );
}
