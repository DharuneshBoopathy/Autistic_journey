import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { getFacets, getTimeline, type TimelineFilters } from '@/lib/gallery';
import { Timeline } from './timeline';
import styles from '@/components/gallery.module.css';

export const metadata: Metadata = { title: 'Timeline — The Autistic Journey' };

// Every viewer sees a different archive, so nothing here may be prerendered.
export const dynamic = 'force-dynamic';

const FILTER_KEYS = ['academicYear', 'eventId', 'uploaderId', 'albumId', 'tag', 'campusZone', 'q'] as const;

export default async function GalleryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const query: Record<string, string> = {};
  const filters: TimelineFilters = {};
  for (const key of FILTER_KEYS) {
    const value = params[key];
    if (typeof value === 'string' && value) {
      query[key] = value;
      filters[key] = value;
    }
  }

  const [page, facets] = await Promise.all([
    getTimeline(user, { filters }),
    getFacets(user),
  ]);

  const withFilter = (key: string, value: string) => {
    const next = new URLSearchParams(query);
    if (next.get(key) === value) next.delete(key);
    else next.set(key, value);
    const qs = next.toString();
    return qs ? `/gallery?${qs}` : '/gallery';
  };

  return (
    <div className={styles.body}>
      <aside className={styles.sidebar} aria-label="Filters">
        <form action="/gallery" style={{ marginBottom: 'var(--space-6)' }}>
          <label className={styles.facetTitle} htmlFor="q">
            Search
          </label>
          <input
            id="q"
            name="q"
            defaultValue={query.q ?? ''}
            placeholder="Caption, place, filename"
            style={{
              width: '100%',
              padding: 'var(--space-2)',
              border: '2px solid var(--ink)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--paper)',
            }}
          />
        </form>

        <p className={styles.facetTitle}>
          {facets.total.toLocaleString()} {facets.total === 1 ? 'photo' : 'photos'}
        </p>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-30)', marginBottom: 'var(--space-6)' }}>
          Everything you&rsquo;re permitted to see. Counts exclude photos shared with others but
          not with you.
        </p>

        {Object.keys(query).length > 0 && (
          <p style={{ marginBottom: 'var(--space-6)' }}>
            <Link href="/gallery" className={styles.facetLink}>
              Clear all filters
            </Link>
          </p>
        )}

        <FacetGroup
          title="Academic year"
          facets={facets.academicYears}
          active={query.academicYear}
          href={(v) => withFilter('academicYear', v)}
        />
        <FacetGroup
          title="Event"
          facets={facets.events}
          active={query.eventId}
          href={(v) => withFilter('eventId', v)}
        />
        <FacetGroup
          title="Uploaded by"
          facets={facets.uploaders}
          active={query.uploaderId}
          href={(v) => withFilter('uploaderId', v)}
        />
      </aside>

      <div className={styles.content}>
        {/* `key` remounts the client component when the filters change, so it does
            not have to reconcile a completely different result set. */}
        <Timeline key={JSON.stringify(query)} initial={page} query={query} />
      </div>
    </div>
  );
}

function FacetGroup({
  title,
  facets,
  active,
  href,
}: {
  title: string;
  facets: Array<{ value: string; label: string; count: number }>;
  active?: string;
  href: (value: string) => string;
}) {
  if (facets.length === 0) return null;

  return (
    <div className={styles.facetGroup}>
      <h2 className={styles.facetTitle}>{title}</h2>
      {facets.map((facet) => (
        <Link
          key={facet.value}
          href={href(facet.value)}
          className={`${styles.facetLink} ${active === facet.value ? styles.facetActive : ''}`}
        >
          <span>{facet.label}</span>
          <span className={styles.facetCount}>{facet.count}</span>
        </Link>
      ))}
    </div>
  );
}
