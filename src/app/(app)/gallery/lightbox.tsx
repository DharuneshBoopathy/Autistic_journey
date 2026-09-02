'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PhotoCard } from '@/lib/gallery';
import styles from '@/components/gallery.module.css';

type Props = {
  photos: PhotoCard[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
};

const dateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'full',
  timeStyle: 'short',
});

/**
 * Fullscreen viewer.
 *
 * Serves the `preview` derivative, never the original — that is the "view is not
 * download" rule expressed in the markup as well as on the server.
 */
export function Lightbox({ photos, index, onClose, onNavigate }: Props) {
  /*
   * Zoom is stored as "which photo is zoomed", not as a boolean, so moving to the
   * next photo resets it by derivation. A boolean would need an effect to clear it,
   * which renders the new image zoomed for one frame before correcting.
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
      if (event.key === 'Escape') onClose();
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
    <div className={`${styles.lightbox} on-dark`} role="dialog" aria-modal="true" aria-label="Photo viewer">
      <div className={styles.lightboxTop}>
        <button ref={closeRef} className={styles.smallButton} onClick={onClose}>
          Close
        </button>
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-40)' }}>
          {index + 1} of {photos.length}
        </span>
        <div className={styles.headerSpacer} />
        <span style={{ fontSize: 'var(--text-sm)' }}>{photo.uploaderName}</span>
      </div>

      <div className={styles.stage}>
        <button
          className={`${styles.navButton} ${styles.navPrev}`}
          onClick={goPrev}
          disabled={index === 0}
          aria-label="Previous photo"
        >
          <Chevron direction="left" />
        </button>

        {/*
          Plain <img> rather than next/image: these bytes come from an
          authorization-checked route with `no-store`, so the optimiser's cache
          would be both useless and a place private images could linger.
        */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/photos/${photo.id}/preview`}
          alt={photo.caption ?? `Photo by ${photo.uploaderName}`}
          className={zoomed ? styles.zoomed : styles.notZoomed}
          style={zoomed ? { transform: 'scale(2)', maxWidth: 'none', maxHeight: 'none' } : undefined}
          onClick={toggleZoom}
          // Deterrents, not protection — anyone who can see this can screenshot it.
          // Stated plainly in SECURITY.md rather than dressed up as security.
          onContextMenu={(event) => event.preventDefault()}
          draggable={false}
        />

        <button
          className={`${styles.navButton} ${styles.navNext}`}
          onClick={goNext}
          disabled={index === photos.length - 1}
          aria-label="Next photo"
        >
          <Chevron direction="right" />
        </button>
      </div>

      <div className={styles.meta}>
        <span>
          <span className={styles.metaKey}>Taken</span>
          {dateFormat.format(new Date(photo.takenAt))}
        </span>
        <span>
          <span className={styles.metaKey}>Size</span>
          {photo.width} × {photo.height}
        </span>
        <span>
          <span className={styles.metaKey}>Visibility</span>
          {photo.visibility}
        </span>
        {photo.caption && (
          <span>
            <span className={styles.metaKey}>Caption</span>
            {photo.caption}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Arrow glyphs as SVG rather than ‹ › characters — whether those render at all
 * depends on the chosen font having them, and when it does not the button is simply
 * an empty circle with no indication of what it does.
 */
function Chevron({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={direction === 'left' ? 'M15 5 L8 12 L15 19' : 'M9 5 L16 12 L9 19'} />
    </svg>
  );
}
