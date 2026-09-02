import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { getAlbumPhotos } from '@/lib/albums';
import { Masthead, ui } from '@/components/ui';
import { AlbumPhotos } from './album-photos';
import { AlbumSettings } from './album-settings';

export const metadata: Metadata = { title: 'Album — The Autistic Journey' };
export const dynamic = 'force-dynamic';

export default async function AlbumPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const result = await getAlbumPhotos(user, (await params).id);

  // An album someone may not open is indistinguishable from one that does not
  // exist — the same answer the API gives, for the same reason.
  if (!result.ok) notFound();

  const album = result.value;

  return (
    <div className={ui.page}>
      <Masthead
        eyebrow="Album"
        title={album.name}
        lede={
          album.description ?? (
            <>
              {album.photos.length} {album.photos.length === 1 ? 'photo' : 'photos'} here that you
              can see. Anyone else opening this album sees their own set.
            </>
          )
        }
        actions={
          <>
            <Link href="/albums" className={`${ui.button} ${ui.buttonQuiet}`}>
              All albums
            </Link>
            <Link href="/gallery" className={`${ui.button} ${ui.buttonQuiet}`}>
              Add from timeline
            </Link>
          </>
        }
      />

      {album.canManage && (
        <AlbumSettings
          id={album.id}
          name={album.name}
          description={album.description}
          visibility={album.visibility}
        />
      )}

      <AlbumPhotos albumId={album.id} canManage={album.canManage} photos={album.photos} />
    </div>
  );
}
