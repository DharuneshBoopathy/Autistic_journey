'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PhotoCard, TimelinePage } from '@/lib/gallery';
import { Lightbox } from './lightbox';
import styles from '@/components/gallery.module.css';

type Props = {
  initial: TimelinePage;
  query: Record<string, string>;
};

const dayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** Group consecutive photos by calendar day, preserving the server's ordering. */
function groupByDay(photos: PhotoCard[]): Array<{ day: string; label: string; photos: PhotoCard[] }> {
  const groups: Array<{ day: string; label: string; photos: PhotoCard[] }> = [];

  for (const photo of photos) {
    const date = new Date(photo.takenAt);
    const day = date.toISOString().slice(0, 10);
    const last = groups[groups.length - 1];

    if (last?.day === day) last.photos.push(photo);
    else groups.push({ day, label: dayFormat.format(date), photos: [photo] });
  }

  return groups;
}

export function Timeline({ initial, query }: Props) {
  const [photos, setPhotos] = useState(initial.photos);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  /*
   * No effect is needed to reset when the filters change: the page renders this
   * component with `key={JSON.stringify(query)}`, so a filter change remounts it and
   * `useState` re-initialises from the new server data. Syncing props into state via
   * an effect would render once with stale photos before correcting itself.
   */

  const loadMore = useCallback(async () => {
    if (!cursor || loading) return;
    setLoading(true);

    try {
      const params = new URLSearchParams({ ...query, cursor });
      const response = await fetch(`/api/timeline?${params}`);
      if (!response.ok) return;

      const page: TimelinePage = await response.json();
      // De-duplicate defensively: a photo uploaded while paging could otherwise
      // shift the window and appear twice, which React would flag as a key clash.
      setPhotos((current) => {
        const seen = new Set(current.map((p) => p.id));
        return [...current, ...page.photos.filter((p) => !seen.has(p.id))];
      });
      setCursor(page.nextCursor);
    } finally {
      setLoading(false);
    }
  }, [cursor, loading, query]);

  // Infinite scroll. `rootMargin` starts the fetch before the sentinel is visible,
  // so the next page is usually there by the time the user reaches it.
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !cursor) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: '600px' },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [cursor, loadMore]);

  const groups = useMemo(() => groupByDay(photos), [photos]);

  const toggleSelect = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selecting = selected.size > 0;

  if (photos.length === 0) {
    return (
      <p className={styles.empty}>
        No photos here yet.{' '}
        {Object.keys(query).length > 0 ? 'Try clearing the filters.' : 'Upload some to begin.'}
      </p>
    );
  }

  return (
    <>
      {groups.map((group) => (
        <section key={group.day}>
          <h2 className={styles.dayHeading}>{group.label}</h2>
          <div className={styles.grid}>
            {group.photos.map((photo) => {
              const isSelected = selected.has(photo.id);

              return (
                <button
                  key={photo.id}
                  type="button"
                  className={`${styles.tile} ${isSelected ? styles.tileSelected : ''}`}
                  onClick={(event) => {
                    // Modifier-click and select-mode both extend the selection
                    // rather than opening the viewer.
                    if (selecting || event.metaKey || event.ctrlKey || event.shiftKey) {
                      toggleSelect(photo.id);
                    } else {
                      setLightboxIndex(photos.indexOf(photo));
                    }
                  }}
                  aria-label={photo.caption ?? `Photo by ${photo.uploaderName}`}
                  aria-pressed={selecting ? isSelected : undefined}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/photos/${photo.id}/thumb`}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    onContextMenu={(event) => event.preventDefault()}
                    draggable={false}
                  />

                  {selecting && (
                    <span className={`${styles.checkbox} ${isSelected ? styles.checkboxOn : ''}`} />
                  )}

                  {/* A quiet marker that this photo is not visible to everyone. */}
                  {photo.visibility !== 'batch' && (
                    <span className={styles.privacyDot} title={`Visible to: ${photo.visibility}`} />
                  )}
                </button>
              );
            })}
          </div>
        </section>
      ))}

      <div ref={sentinel} className={styles.sentinel} />
      {loading && <p className={styles.loading}>Loading more…</p>}
      {!cursor && photos.length > 0 && <p className={styles.loading}>That&rsquo;s everything.</p>}

      {selecting && (
        <div className={styles.selectionBar} role="status">
          <span>{selected.size} selected</span>
          <button className={styles.smallButton} onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      {lightboxIndex !== null && (
        <Lightbox
          photos={photos}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      )}
    </>
  );
}
