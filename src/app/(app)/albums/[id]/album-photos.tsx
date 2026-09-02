'use client';

import { useCallback, useState } from 'react';
import type { PhotoCard } from '@/lib/gallery';
import { ArchiveImage } from '@/components/archive-image';
import { Empty, VISIBILITY_SHORT } from '@/components/ui';
import { Viewer } from '@/app/(app)/gallery/viewer';
import { Check } from '@/app/(app)/gallery/icons';
import styles from '@/components/gallery.module.css';

/**
 * The photos in one album, in curation order.
 *
 * `photos` is what the *server* decided this viewer may see — the album's contents
 * were joined against `visible_photos`, not against `photos`. Nothing here filters
 * anything; there is no second copy of the rule in the browser.
 */
export function AlbumPhotos({
  albumId,
  canManage,
  photos: initial,
}: {
  albumId: string;
  canManage: boolean;
  photos: PhotoCard[];
}) {
  const [photos, setPhotos] = useState(initial);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const toggleSelect = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** Take a photo out of the album. The photo itself is untouched. */
  const removeSelected = useCallback(async () => {
    setBusy(true);
    const ids = [...selected];

    try {
      const response = await fetch(`/api/albums/${albumId}/photos`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ photoIds: ids }),
      });

      if (!response.ok) return;

      const removed = new Set(ids);
      setPhotos((current) => current.filter((p) => !removed.has(p.id)));
      setSelected(new Set());
    } finally {
      setBusy(false);
    }
  }, [albumId, selected]);

  const refreshPhoto = useCallback(async (photoId: string) => {
    const response = await fetch(`/api/photos/${photoId}`);

    // A photo narrowed out of our own reach 404s, exactly as it would on reload.
    if (!response.ok) {
      setPhotos((current) => current.filter((p) => p.id !== photoId));
      return;
    }

    const { photo } = await response.json();
    setPhotos((current) =>
      current.map((p) =>
        p.id === photoId ? { ...p, caption: photo.caption, visibility: photo.visibility } : p,
      ),
    );
  }, []);

  if (photos.length === 0) {
    return (
      <Empty title="Nothing to show you here">
        Either this album is empty, or everything in it is shared with someone other than you.
        Filing a photo into an album never widens who can see it.
      </Empty>
    );
  }

  const selecting = selected.size > 0;

  return (
    <>
      <div className={styles.grid}>
        {photos.map((photo, index) => {
          const isSelected = selected.has(photo.id);

          return (
            <button
              key={photo.id}
              type="button"
              className={`${styles.tile} ${isSelected ? styles.tileSelected : ''}`}
              onClick={(event) => {
                if (canManage && (selecting || event.metaKey || event.ctrlKey || event.shiftKey)) {
                  toggleSelect(photo.id);
                } else {
                  setViewerIndex(index);
                }
              }}
              aria-label={photo.caption ?? `Photo by ${photo.uploaderName}`}
              aria-pressed={selecting ? isSelected : undefined}
            >
              <ArchiveImage
                src={`/api/photos/${photo.id}/thumb`}
                alt=""
                loading="lazy"
                decoding="async"
              />

              {selecting && (
                <span className={`${styles.check} ${isSelected ? styles.checkOn : ''}`}>
                  {isSelected && <Check size={10} />}
                </span>
              )}

              {photo.visibility !== 'batch' && (
                <span className={styles.privacyTag}>{VISIBILITY_SHORT[photo.visibility]}</span>
              )}
            </button>
          );
        })}
      </div>

      {selecting && (
        <div className={styles.selectionBar} role="status">
          <span className={styles.selectionCount}>{selected.size} selected</span>
          <button
            className={styles.barButton}
            disabled={busy}
            onClick={() => void removeSelected()}
          >
            Remove from album
          </button>
          <button className={styles.barButton} onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      {viewerIndex !== null && (
        <Viewer
          photos={photos}
          index={viewerIndex}
          onClose={() => setViewerIndex(null)}
          onNavigate={setViewerIndex}
          onChanged={refreshPhoto}
        />
      )}
    </>
  );
}
