import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { listAlbums } from '@/lib/albums';
import { Empty, Masthead, ui } from '@/components/ui';
import { ArchiveImage } from '@/components/archive-image';
import { NewAlbum } from './new-album';
import styles from '@/components/gallery.module.css';

export const metadata: Metadata = { title: 'Albums — The Autistic Journey' };
export const dynamic = 'force-dynamic';

export default async function AlbumsPage() {
  const user = await requireUser();
  const albums = await listAlbums(user);

  return (
    <div className={ui.page}>
      <Masthead
        eyebrow="Collections"
        title="Albums"
        lede="An album gathers photos; it does not share them. Each person opening an album sees only the photos already shared with them, so counts differ from one member to the next."
        actions={<NewAlbum />}
      />

      {albums.length === 0 ? (
        <Empty title="No albums yet">
          Albums are private until you set them otherwise. Make one to group a trip, a
          semester, or an evening.
        </Empty>
      ) : (
        <div className={styles.cardGrid}>
          {albums.map((album) => (
            <Link key={album.id} href={`/albums/${album.id}`} className={styles.card}>
              <div className={styles.cardCover}>
                {album.coverPhotoId ? (
                  <ArchiveImage
                    src={`/api/photos/${album.coverPhotoId}/thumb`}
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <span className={styles.cardEmptyMark}>Empty</span>
                )}
              </div>
              <div className={styles.cardName}>{album.name}</div>
              <div className={styles.cardMeta}>
                {album.visibleCount} {album.visibleCount === 1 ? 'photo' : 'photos'} you can see
                {album.visibility === 'private' ? ' · Only you' : ''}
                {!album.isMine ? ' · Someone else’s' : ''}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
