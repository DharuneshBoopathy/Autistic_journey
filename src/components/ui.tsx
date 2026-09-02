import type { ReactNode } from 'react';
import styles from './ui.module.css';

/**
 * Presentational primitives shared across the app.
 *
 * These are plain server components — none of them hold state — so they can be used
 * from either side of the client boundary without dragging JavaScript along.
 */

export { styles as ui };

export function Masthead({
  eyebrow,
  title,
  lede,
  actions,
}: {
  eyebrow?: string;
  title: string;
  lede?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className={styles.masthead}>
      <div>
        {eyebrow && <span className={styles.eyebrow}>{eyebrow}</span>}
        <h1 className={styles.title}>{title}</h1>
        {lede && <p className={styles.lede}>{lede}</p>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}

export function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className={styles.empty}>
      <p className={styles.emptyTitle}>{title}</p>
      {children && <p className={styles.emptyBody}>{children}</p>}
    </div>
  );
}

export type BadgeTone = 'neutral' | 'accent' | 'danger' | 'success' | 'notice';

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  const toneClass =
    tone === 'accent'
      ? styles.badgeAccent
      : tone === 'danger'
        ? styles.badgeDanger
        : tone === 'success'
          ? styles.badgeSuccess
          : tone === 'notice'
            ? styles.badgeNotice
            : '';

  return <span className={`${styles.badge} ${toneClass}`}>{children}</span>;
}

export function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div className={styles.stat}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>{value}</div>
      {note && <div className={styles.statNote}>{note}</div>}
    </div>
  );
}

/** Human-readable byte size. Used for storage figures, which are always inexact. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${Math.round(bytes / 1_048_576)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/**
 * The four visibility states, described in the words a member would use.
 *
 * Kept in one place because these strings appear in the grid, the viewer, the
 * editor and the upload form, and they must agree — a photo labelled one thing in
 * two places is worse than a photo labelled nothing.
 */
export const VISIBILITY_LABEL: Record<string, string> = {
  batch: 'Everyone in the batch',
  group: 'Specific groups',
  selected: 'Specific people',
  private: 'Only me',
};

export const VISIBILITY_SHORT: Record<string, string> = {
  batch: 'Batch',
  group: 'Groups',
  selected: 'People',
  private: 'Private',
};
