'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PhotoCard, TimelinePage } from '@/lib/gallery';
import { VISIBILITY_SHORT } from '@/components/ui';
import { ArchiveImage } from '@/components/archive-image';
import { Viewer } from './viewer';
import { Check } from './icons';
import styles from '@/components/gallery.module.css';
import ui from '@/components/ui.module.css';

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
function groupByDay(photos: PhotoCard[]) {
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
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [albums, setAlbums] = useState<Array<{ id: string; name: string }>>([]);
  const sentinel = useRef<HTMLDivElement>(null);

  /*
   * No effect syncs props into state: the page renders this component with
   * `key={JSON.stringify(query)}`, so a filter change remounts it and `useState`
   * re-initialises from the new server data. Syncing via an effect would render once
   * with stale photos before correcting itself.
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
      { rootMargin: '700px' },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [cursor, loadMore]);

  const groups = useMemo(() => groupByDay(photos), [photos]);

  // Albums are fetched only once something is selected — the list is useless until
  // then, and most visits never select anything.
  useEffect(() => {
    if (selected.size === 0 || albums.length > 0) return;

    let cancelled = false;
    void (async () => {
      const response = await fetch('/api/albums');
      if (!response.ok || cancelled) return;

      const body = await response.json();
      // Only albums the viewer owns: filing into someone else's album is a write
      // the server would refuse anyway, so it is not offered.
      setAlbums(
        body.albums
          .filter((a: { isMine: boolean }) => a.isMine)
          .map((a: { id: string; name: string }) => ({ id: a.id, name: a.name })),
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [selected.size, albums.length]);

  /** File the selection into an album. Nothing about their visibility changes. */
  const addToAlbum = useCallback(
    async (albumId: string) => {
      setBusy(true);
      try {
        await fetch(`/api/albums/${albumId}/photos`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ photoIds: [...selected] }),
        });
        setSelected(new Set());
      } finally {
        setBusy(false);
      }
    },
    [selected],
  );

  const toggleSelect = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** Drop a photo from the local list after it is deleted or hidden from us. */
  const dropPhoto = useCallback((photoId: string) => {
    setPhotos((current) => current.filter((p) => p.id !== photoId));
    setSelected((current) => {
      const next = new Set(current);
      next.delete(photoId);
      return next;
    });
  }, []);

  /**
   * Refresh one photo after the panel edits it.
   *
   * A narrowed photo may no longer be visible to us at all, in which case the fetch
   * 404s and it is removed — the same answer the server would give on reload.
   */
  const refreshPhoto = useCallback(async (photoId: string) => {
    const response = await fetch(`/api/photos/${photoId}`);

    if (!response.ok) {
      dropPhoto(photoId);
      return;
    }

    const { photo } = await response.json();
    setPhotos((current) =>
      current.map((p) =>
        p.id === photoId ? { ...p, caption: photo.caption, visibility: photo.visibility } : p,
      ),
    );
  }, [dropPhoto]);

  const bulk = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      try {
        const response = await fetch('/api/photos/bulk', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...body, photoIds: [...selected] }),
        });

        if (!response.ok) return;

        // Reload rather than patching locally: a bulk change can alter which photos
        // are visible at all, and guessing the new set in the browser would be a
        // second, weaker copy of the server's rule.
        window.location.reload();
      } finally {
        setBusy(false);
      }
    },
    [selected],
  );

  const selecting = selected.size > 0;

  if (photos.length === 0) {
    return (
      <div className={ui.empty}>
        <p className={ui.emptyTitle}>Nothing here yet</p>
        <p className={ui.emptyBody}>
          {Object.keys(query).length > 0
            ? 'No photos match these filters. Try clearing them.'
            : 'Photos you upload will appear here, newest first.'}
        </p>
      </div>
    );
  }

  return (
    <>
      {groups.map((group) => (
        <section key={group.day} className={styles.day}>
          <div className={styles.dayHead}>
            <h2 className={styles.dayLabel}>{group.label}</h2>
            <span className={styles.dayRule} />
            <span className={styles.dayCount}>
              {group.photos.length} {group.photos.length === 1 ? 'photo' : 'photos'}
            </span>
          </div>

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
                      setViewerIndex(photos.indexOf(photo));
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

                  {/* A quiet marker for anything not visible to the whole batch. */}
                  {photo.visibility !== 'batch' && (
                    <span className={styles.privacyTag}>{VISIBILITY_SHORT[photo.visibility]}</span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      ))}

      <div ref={sentinel} className={styles.sentinel} />
      {loading && <p className={styles.status}>Loading more…</p>}
      {!cursor && <p className={styles.status}>End of the archive.</p>}

      {selecting && (
        <div className={styles.selectionBar} role="status">
          <span className={styles.selectionCount}>{selected.size} selected</span>

          <select
            className={styles.barSelect}
            defaultValue=""
            disabled={busy}
            onChange={(event) => {
              const value = event.target.value;
              event.target.value = '';
              if (value) void bulk({ action: 'setVisibility', visibility: value });
            }}
            aria-label="Change visibility of selected photos"
          >
            <option value="" disabled>
              Change visibility…
            </option>
            <option value="batch">Everyone in the batch</option>
            <option value="private">Only me</option>
          </select>

          {albums.length > 0 && (
            <select
              className={styles.barSelect}
              defaultValue=""
              disabled={busy}
              onChange={(event) => {
                const value = event.target.value;
                event.target.value = '';
                if (value) void addToAlbum(value);
              }}
              aria-label="Add selected photos to an album"
            >
              <option value="" disabled>
                Add to album…
              </option>
              {albums.map((album) => (
                <option key={album.id} value={album.id}>
                  {album.name}
                </option>
              ))}
            </select>
          )}

          <button
            className={styles.barButton}
            disabled={busy}
            onClick={() => void bulk({ action: 'delete' })}
          >
            Delete
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
