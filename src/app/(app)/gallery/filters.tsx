'use client';

import { useState } from 'react';
import styles from '@/components/gallery.module.css';

/**
 * The facet list, collapsed on a phone.
 *
 * On a wide screen the filters are a permanent column and this renders as a plain
 * wrapper — the toggle is hidden by CSS and the panel is always shown. Below the
 * sidebar's breakpoint the column becomes a full-width block above the photos, and
 * a dozen facet rows push the archive itself off the screen, so it collapses behind
 * one control instead.
 *
 * The children are server-rendered links passed straight through; nothing about
 * which facets exist, or their counts, is decided here.
 */
export function Filters({ children, activeCount }: { children: React.ReactNode; activeCount: number }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={styles.filterToggle}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <span>Filters</span>
        <span className={styles.filterToggleMark}>
          {activeCount > 0 ? `${activeCount} on` : open ? 'Hide' : 'Show'}
        </span>
      </button>

      <div className={`${styles.facets} ${open ? styles.facetsOpen : ''}`}>{children}</div>
    </>
  );
}
