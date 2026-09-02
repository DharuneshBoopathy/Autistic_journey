import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { getFacets, getTimeline, type TimelineFilters } from '@/lib/gallery';
import { Timeline } from './timeline';
import { Search } from './icons';
import styles from '@/components/gallery.module.css';
import ui from '@/components/ui.module.css';

export const metadata: Metadata = { title: 'Timeline — The Autistic Journey' };

// Every viewer sees a different archive, so nothing here may be prerendered.
export const dynamic = 'force-dynamic';

const FILTER_KEYS = [
  'academicYear',
  'eventId',
  'uploaderId',
  'albumId',
  'tag',
  'campusZone',
  'q',
] as const;

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

  const [page, facets] = await Promise.all([getTimeline(user, { filters }), getFacets(user)]);

  const withFilter = (key: string, value: string) => {
    const next = new URLSearchParams(query);
    if (next.get(key) === value) next.delete(key);
    else next.set(key, value);
    const qs = next.toString();
    return qs ? `/gallery?${qs}` : '/gallery';
  };

  const filtered = Object.keys(query).length > 0;

  return (
    <div className={styles.body}>
      <aside className={styles.sidebar} aria-label="Search and filters">
        <form action="/gallery" className={styles.searchRow} role="search">
          {/* Filters other than the query are preserved across a search. */}
          {Object.entries(query)
            .filter(([key]) => key !== 'q')
            .map(([key, value]) => (
              <input key={key} type="hidden" name={key} value={value} />
            ))}
          <input
            className={ui.input}
            name="q"
            defaultValue={query.q ?? ''}
            placeholder="Search captions"
            aria-label="Search the archive"
          />
          <button className={`${ui.button} ${ui.buttonQuiet}`} type="submit" aria-label="Search">
            <Search size={15} />
          </button>
        </form>

        <div className={styles.counts}>
          <div className={styles.countValue}>{facets.total.toLocaleString()}</div>
          <div className={styles.countLabel}>
            {facets.total === 1 ? 'Photo' : 'Photos'} visible to you
          </div>
          <p className={styles.countNote}>
            Counts describe only what you are permitted to see. Photos shared with others but not
            with you are not included anywhere here.
          </p>
        </div>

        {filtered && (
          <p className={styles.facetGroup}>
            <Link href="/gallery" className={ui.badge}>
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
          <span className={styles.facetLabel}>{facet.label}</span>
          <span className={styles.facetCount}>{facet.count}</span>
        </Link>
      ))}
    </div>
  );
}
