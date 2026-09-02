'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PhotoCard } from '@/lib/gallery';
import { VISIBILITY_LABEL } from '@/components/ui';
import { ArchiveImage } from '@/components/archive-image';
import { PhotoPanel } from './photo-panel';
import { ChevronLeft, ChevronRight, Close } from './icons';
import styles from '@/components/gallery.module.css';
import ui from '@/components/ui.module.css';

type Props = {
  photos: PhotoCard[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onChanged: (photoId: string) => void;
};

/**
 * Fullscreen viewer with a metadata and editing panel.
 *
 * Serves the `preview` derivative, never the original — "view is not download"
 * expressed in the markup as well as on the server.
 */
export function Viewer({ photos, index, onClose, onNavigate, onChanged }: Props) {
  /*
   * Zoom is stored as "which photo is zoomed", not a boolean, so moving to the next
   * photo resets it by derivation. A boolean would need an effect to clear it, which
   * renders the new image zoomed for one frame before correcting.
   */
  const [zoomedFor, setZoomedFor] = useState<number | null>(null);
  const zoomed = zoomedFor === index;
  const toggleZoom = useCallback(
    () => setZoomedFor((current) => (current === index ? null : index)),
    [index],
  );

  const closeRef = useRef<HTMLButtonElement>(null);
  const photo = photos[index];

  const goPrev = useCallback(() => {
    if (index > 0) onNavigate(index - 1);
  }, [index, onNavigate]);

  const goNext = useCallback(() => {
    if (index < photos.length - 1) onNavigate(index + 1);
  }, [index, photos.length, onNavigate]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Let arrow keys move the caret when the user is typing in the panel.
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement;

      if (event.key === 'Escape') onClose();
      else if (typing) return;
      else if (event.key === 'ArrowLeft') goPrev();
      else if (event.key === 'ArrowRight') goNext();
      else if (event.key === ' ') {
        event.preventDefault();
        toggleZoom();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, goPrev, goNext, toggleZoom]);

  // Stop the page behind from scrolling while the viewer is open.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Move focus in, so keyboard users are not left navigating the page behind.
  useEffect(() => closeRef.current?.focus(), []);

  if (!photo) return null;

  return (
    <div className={styles.viewer} role="dialog" aria-modal="true" aria-label="Photo viewer">
      <div className={styles.viewerMain}>
        <div className={styles.viewerBar}>
          <button
            ref={closeRef}
            className={`${ui.button} ${ui.buttonQuiet} ${ui.buttonSmall}`}
            onClick={onClose}
          >
            <Close size={13} />
            Close
          </button>
          <span className={styles.viewerCount}>
            {index + 1} / {photos.length}
          </span>
          <div className={ui.spacer} />
          <span className={styles.viewerCount}>
            {photo.uploaderName} · {VISIBILITY_LABEL[photo.visibility] ?? photo.visibility}
          </span>
        </div>

        <div className={styles.stage}>
          <button
            className={`${styles.nav} ${styles.navPrev}`}
            onClick={goPrev}
            disabled={index === 0}
            aria-label="Previous photo"
          >
            <ChevronLeft />
          </button>

          {/*
            Plain <img> rather than next/image: these bytes come from an
            authorization-checked route with `no-store`, so the optimiser's cache
            would be both useless and a place private images could linger.
          */}
          <ArchiveImage
            key={photo.id}
            src={`/api/photos/${photo.id}/preview`}
            alt={photo.caption ?? `Photo by ${photo.uploaderName}`}
            className={zoomed ? styles.zoomOut : styles.zoomIn}
            style={
              zoomed ? { transform: 'scale(2)', maxWidth: 'none', maxHeight: 'none' } : undefined
            }
            onClick={toggleZoom}
          />

          <button
            className={`${styles.nav} ${styles.navNext}`}
            onClick={goNext}
            disabled={index === photos.length - 1}
            aria-label="Next photo"
          >
            <ChevronRight />
          </button>
        </div>
      </div>

      {/* `key` remounts the panel per photo, so its form state never carries over
          from the previous one — editing photo A then pressing → must not leave A's
          unsaved caption sitting in B's field. */}
      <PhotoPanel key={photo.id} photoId={photo.id} onChanged={onChanged} onClosed={onClose} />
    </div>
  );
}
