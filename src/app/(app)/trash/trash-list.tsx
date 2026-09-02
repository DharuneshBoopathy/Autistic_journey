'use client';

import { useState } from 'react';
import type { DeletedPhoto } from '@/lib/photo-mutations';
import ui from '@/components/ui.module.css';

const dayFormat = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** Whole days left before the sweep removes a photo for good. */
function daysLeft(purgeAfter: string): number {
  return Math.max(0, Math.ceil((new Date(purgeAfter).getTime() - Date.now()) / 86_400_000));
}

/**
 * The recovery list.
 *
 * There are no thumbnails here on purpose: a deleted photo is hidden from every read
 * path, including the image routes, so a preview would either be a broken image or a
 * hole in the very rule the deletion just applied.
 */
export function TrashList({
  photos: initial,
  showUploader,
}: {
  photos: DeletedPhoto[];
  showUploader: boolean;
}) {
  const [photos, setPhotos] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function restore(id: string) {
    setBusy(id);
    setError(null);

    try {
      const response = await fetch(`/api/photos/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'restore' }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? 'Could not restore that photo.');
        return;
      }

      setPhotos((current) => current.filter((p) => p.id !== id));
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {error && (
        <p className={ui.error} role="alert">
          {error}
        </p>
      )}

      <div className={ui.list}>
        {photos.map((photo) => {
          const left = daysLeft(photo.purgeAfter);

          return (
            <div key={photo.id} className={ui.listRow}>
              <div className={ui.listMain}>
                <div className={ui.listTitle}>{photo.caption || 'Untitled photo'}</div>
                <div className={ui.listMeta}>
                  Taken {dayFormat.format(new Date(photo.takenAt))} · deleted{' '}
                  {dayFormat.format(new Date(photo.deletedAt))}
                  {showUploader && !photo.isMine ? ` · uploaded by ${photo.uploaderName}` : ''}
                  {' · '}
                  {left === 0 ? 'removed within the day' : `${left} ${left === 1 ? 'day' : 'days'} left`}
                </div>
              </div>

              <button
                className={`${ui.button} ${ui.buttonSmall}`}
                disabled={busy === photo.id}
                onClick={() => void restore(photo.id)}
              >
                {busy === photo.id ? 'Restoring…' : 'Restore'}
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}
