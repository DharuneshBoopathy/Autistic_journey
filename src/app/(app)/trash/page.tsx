import type { Metadata } from 'next';
import { requireUser, hasRole } from '@/lib/auth';
import { listDeleted } from '@/lib/photo-mutations';
import { env } from '@/lib/env';
import { Empty, Masthead, ui } from '@/components/ui';
import { TrashList } from './trash-list';

export const metadata: Metadata = { title: 'Trash — The Autistic Journey' };
export const dynamic = 'force-dynamic';

export default async function TrashPage() {
  const user = await requireUser();
  const photos = await listDeleted(user);
  const admin = hasRole(user, 'admin');

  return (
    <div className={ui.pageNarrow}>
      <Masthead
        eyebrow="Recovery"
        title="Trash"
        lede={
          <>
            Deleted photos stay recoverable for {env.DELETED_RETENTION_DAYS} days, then the sweep
            removes the stored files and the record for good. While they are here they are
            invisible to everyone, including whoever uploaded them.
          </>
        }
      />

      {photos.length === 0 ? (
        <Empty title="Nothing deleted">
          {admin
            ? 'Nobody in the batch has deleted a photo that is still recoverable.'
            : 'Photos you delete will wait here before they are removed permanently.'}
        </Empty>
      ) : (
        <TrashList photos={photos} showUploader={admin} />
      )}
    </div>
  );
}
