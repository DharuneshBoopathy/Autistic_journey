'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { EventSummary } from '@/lib/taxonomy';
import { Empty, Section } from '@/components/ui';
import ui from '@/components/ui.module.css';

const dayFormat = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** "12 Mar 2024 – 14 Mar 2024", or just the one date, or nothing. */
function describeDates(event: EventSummary): string {
  if (!event.startsOn) return '';
  const start = dayFormat.format(new Date(event.startsOn));
  if (!event.endsOn || event.endsOn === event.startsOn) return start;
  return `${start} – ${dayFormat.format(new Date(event.endsOn))}`;
}

/**
 * Events, with creation open to every member.
 *
 * Deleting is admin-only and enforced in `deleteEvent`, not here: mislabelling an
 * event is cheap to fix, but deleting one detaches it from every photo filed under
 * it. The photos survive — `photos.event_id` is ON DELETE SET NULL — but the
 * grouping does not.
 */
export function Events({ events, canDelete }: { events: EventSummary[]; canDelete: boolean }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [academicYear, setAcademicYear] = useState('');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: trimmed,
          academicYear: academicYear.trim() || null,
          startsOn: startsOn || null,
          endsOn: endsOn || startsOn || null,
        }),
      });

      if (!response.ok) {
        setError('Could not create that event.');
        return;
      }

      setName('');
      setAcademicYear('');
      setStartsOn('');
      setEndsOn('');
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(eventId: string, eventName: string) {
    if (
      !confirm(
        `Delete "${eventName}"? The photos filed under it are kept — they simply stop being grouped.`,
      )
    ) {
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`/api/events/${eventId}`, { method: 'DELETE' });
      if (!response.ok) {
        setError('Could not delete that event.');
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Section title="Add an event">
        <form onSubmit={create} className={ui.stack}>
          <div className={ui.row}>
            <label className={ui.field} style={{ flex: 2, minWidth: '14rem' }}>
              <span className={ui.label}>Name</span>
              <input
                className={ui.input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Farewell, Hostel Night, Industrial Visit…"
                maxLength={160}
              />
            </label>

            <label className={ui.field} style={{ flex: 1, minWidth: '8rem' }}>
              <span className={ui.label}>Academic year</span>
              <input
                className={ui.input}
                value={academicYear}
                onChange={(e) => setAcademicYear(e.target.value)}
                placeholder="2023-24"
                maxLength={40}
              />
            </label>
          </div>

          <div className={ui.row}>
            <label className={ui.field} style={{ flex: 1, minWidth: '10rem' }}>
              <span className={ui.label}>Starts</span>
              <input
                className={ui.input}
                type="date"
                value={startsOn}
                onChange={(e) => setStartsOn(e.target.value)}
              />
            </label>

            <label className={ui.field} style={{ flex: 1, minWidth: '10rem' }}>
              <span className={ui.label}>Ends</span>
              <input
                className={ui.input}
                type="date"
                value={endsOn}
                onChange={(e) => setEndsOn(e.target.value)}
              />
              <span className={ui.hint}>Leave blank for a single day.</span>
            </label>
          </div>

          {error && (
            <p className={ui.error} role="alert">
              {error}
            </p>
          )}

          <div>
            <button className={ui.button} type="submit" disabled={busy || name.trim() === ''}>
              {busy ? 'Saving…' : 'Add event'}
            </button>
          </div>
        </form>
      </Section>

      <Section title="All events">
        {events.length === 0 ? (
          <Empty title="No events yet">
            Add one, then file photos under it from the photo itself or from the timeline.
          </Empty>
        ) : (
          <div className={ui.list}>
            {events.map((event) => {
              const dates = describeDates(event);

              return (
                <div key={event.id} className={ui.listRow}>
                  <div className={ui.listMain}>
                    <div className={ui.listTitle}>
                      <Link href={`/gallery?eventId=${event.id}`}>{event.name}</Link>
                    </div>
                    <div className={ui.listMeta}>
                      {event.visibleCount} {event.visibleCount === 1 ? 'photo' : 'photos'} you can
                      see
                      {event.academicYear ? ` · ${event.academicYear}` : ''}
                      {dates ? ` · ${dates}` : ''}
                    </div>
                  </div>

                  {canDelete && (
                    <button
                      className={`${ui.button} ${ui.buttonSmall} ${ui.buttonQuiet}`}
                      disabled={busy}
                      onClick={() => void remove(event.id, event.name)}
                    >
                      Delete
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </>
  );
}
