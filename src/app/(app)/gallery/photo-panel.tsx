'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PhotoDetail } from '@/lib/gallery';
import { VISIBILITY_LABEL } from '@/components/ui';
import { Check, Close, Download, Trash } from './icons';
import styles from '@/components/gallery.module.css';
import ui from '@/components/ui.module.css';

type Directory = {
  people: Array<{ id: string; displayName: string }>;
  groups: Array<{ id: string; name: string; memberCount: number }>;
};

type Visibility = 'batch' | 'group' | 'selected' | 'private';

const VISIBILITIES: Visibility[] = ['batch', 'group', 'selected', 'private'];

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeStyle: 'short' });

/**
 * Metadata and editing for one photo.
 *
 * Loads its own detail rather than taking it from the grid: the grid row carries
 * only what a tile needs, and the panel needs tags, event, location and the rest.
 *
 * Whether the fields are editable is decided by the server (`canEdit` in the
 * response), not by comparing ids in the browser — a client-side check would be a
 * suggestion, and the API refuses the write regardless.
 */
export function PhotoPanel({
  photoId,
  onChanged,
  onClosed,
}: {
  photoId: string;
  onChanged: (photoId: string) => void;
  onClosed: () => void;
}) {
  const [photo, setPhoto] = useState<PhotoDetail | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  // Draft state for the editable fields.
  const [caption, setCaption] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('private');
  const [principals, setPrincipals] = useState<Set<string>>(new Set());
  const [eventId, setEventId] = useState('');
  const [academicYear, setAcademicYear] = useState('');
  const [locationText, setLocationText] = useState('');

  /*
   * Tags are held separately from the draft above because they are saved through a
   * different endpoint with a different rule: anyone who can *see* a photo may tag
   * it, while only its uploader may change its caption or visibility. Folding them
   * into "Save changes" would imply they share a permission they do not.
   */
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [events, setEvents] = useState<Array<{ id: string; name: string }>>([]);

  // Admin-only: who a single-use download grant would be issued to, and why.
  const [grantTo, setGrantTo] = useState('');
  const [grantReason, setGrantReason] = useState('');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const response = await fetch(`/api/photos/${photoId}`);
      if (!response.ok || cancelled) return;

      const body = await response.json();
      if (cancelled) return;

      setPhoto(body.photo);
      setCanEdit(body.canEdit);
      setIsAdmin(body.isAdmin);
      setCaption(body.photo.caption ?? '');
      setVisibility(body.photo.visibility);
      setEventId(body.photo.eventId ?? '');
      setAcademicYear(body.photo.academicYear ?? '');
      setLocationText(body.photo.locationText ?? '');
      setTags(body.photo.tags ?? []);
    })();

    return () => {
      cancelled = true;
    };
  }, [photoId]);

  // The directory is only needed once the user picks a sharing mode that requires it.
  useEffect(() => {
    if (directory) return;
    if (!isAdmin && !canEdit) return;
    if (!isAdmin && visibility !== 'group' && visibility !== 'selected') return;

    let cancelled = false;
    (async () => {
      const response = await fetch('/api/directory');
      if (!response.ok || cancelled) return;
      setDirectory(await response.json());
    })();

    return () => {
      cancelled = true;
    };
  }, [canEdit, isAdmin, visibility, directory]);

  /*
   * Events (for the picker) and the tags already in use (as suggestions).
   *
   * Both lists are viewer-scoped on the server: `listEvents` counts through
   * `visible_photos`, and `/api/tags` returns only tags that appear on a photo this
   * viewer can see. Suggesting from the whole tag table would let someone type a
   * letter and learn the names of events in photos they cannot open.
   */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [eventsResponse, tagsResponse] = await Promise.all([
        canEdit ? fetch('/api/events') : Promise.resolve(null),
        fetch('/api/tags'),
      ]);

      if (cancelled) return;

      if (eventsResponse?.ok) {
        const body = await eventsResponse.json();
        if (!cancelled) {
          setEvents(body.events.map((e: { id: string; name: string }) => ({ id: e.id, name: e.name })));
        }
      }

      if (tagsResponse.ok) {
        const body = await tagsResponse.json();
        if (!cancelled) setSuggestions(body.tags.map((t: { name: string }) => t.name));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canEdit]);

  const togglePrincipal = (id: string) => {
    setPrincipals((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = useCallback(async () => {
    if (!photo) return;
    setSaving(true);
    setMessage(null);

    const body: Record<string, unknown> = {};
    if (caption !== (photo.caption ?? '')) body.caption = caption || null;
    if (eventId !== (photo.eventId ?? '')) body.eventId = eventId || null;
    if (academicYear !== (photo.academicYear ?? '')) body.academicYear = academicYear || null;
    if (locationText !== (photo.locationText ?? '')) body.locationText = locationText || null;

    if (visibility !== photo.visibility || principals.size > 0) {
      body.visibility = visibility;
      if (visibility === 'group' || visibility === 'selected') {
        body.principalIds = [...principals];
      }
    }

    if (Object.keys(body).length === 0) {
      setSaving(false);
      setMessage({ tone: 'success', text: 'Nothing to save.' });
      return;
    }

    try {
      const response = await fetch(`/api/photos/${photo.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        setMessage({ tone: 'error', text: result.error ?? 'Could not save those changes.' });
        return;
      }

      setMessage({ tone: 'success', text: 'Saved.' });
      onChanged(photo.id);
      setPhoto({
        ...photo,
        caption: caption || null,
        visibility,
        eventId: eventId || null,
        eventName: events.find((e) => e.id === eventId)?.name ?? null,
        academicYear: academicYear || null,
        locationText: locationText || null,
      });
    } catch {
      setMessage({ tone: 'error', text: 'Network error. Nothing was changed.' });
    } finally {
      setSaving(false);
    }
  }, [photo, caption, visibility, principals, eventId, academicYear, locationText, events, onChanged]);

  const remove = useCallback(async () => {
    if (!photo) return;
    setSaving(true);

    try {
      const response = await fetch(`/api/photos/${photo.id}`, { method: 'DELETE' });
      if (!response.ok) {
        setMessage({ tone: 'error', text: 'Could not delete that photo.' });
        return;
      }
      onChanged(photo.id);
      onClosed();
    } finally {
      setSaving(false);
    }
  }, [photo, onChanged, onClosed]);

  /**
   * Attach or detach one tag, immediately.
   *
   * Not batched into "Save changes" because tagging is open to anyone who can see
   * the photo, while the fields above are the uploader's. Saving them together
   * would make one button carry two different permissions, and fail confusingly
   * for a viewer who is allowed to do only half of it.
   */
  const changeTag = useCallback(
    async (name: string, attach: boolean) => {
      if (!photo) return;
      const tag = name.trim().toLowerCase();
      if (!tag) return;

      // Move the chip first; the request is small and the list is cheap to put back.
      setTags((current) =>
        attach
          ? current.includes(tag)
            ? current
            : [...current, tag].sort()
          : current.filter((t) => t !== tag),
      );

      const response = await fetch(`/api/photos/${photo.id}/tags`, {
        method: attach ? 'POST' : 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tags: [tag] }),
      });

      if (!response.ok) {
        setTags((current) =>
          attach ? current.filter((t) => t !== tag) : [...current, tag].sort(),
        );
        setMessage({ tone: 'error', text: 'Could not change that tag.' });
      }
    },
    [photo],
  );

  const issueGrant = useCallback(async () => {
    if (!photo || !grantTo) return;
    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch('/api/admin/download-grants', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          photoId: photo.id,
          userId: grantTo,
          reason: grantReason.trim() || undefined,
          expiresInMinutes: 1440,
        }),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        setMessage({ tone: 'error', text: result.error ?? 'Could not issue that grant.' });
        return;
      }

      setMessage({ tone: 'success', text: 'Grant issued. It expires in a day if unused.' });
      setGrantTo('');
      setGrantReason('');
    } catch {
      setMessage({ tone: 'error', text: 'Network error. No grant was issued.' });
    } finally {
      setSaving(false);
    }
  }, [photo, grantTo, grantReason]);

  if (!photo) {
    return (
      <aside className={styles.aside}>
        <p className={styles.asideTitle}>Details</p>
        <p className={ui.hint}>Loading…</p>
      </aside>
    );
  }

  const needsPicker = visibility === 'group' || visibility === 'selected';
  const options = visibility === 'group' ? (directory?.groups ?? []) : (directory?.people ?? []);

  return (
    <aside className={styles.aside}>
      <p className={styles.asideTitle}>Details</p>

      {message && (
        <p className={message.tone === 'error' ? ui.error : ui.success} role="status">
          {message.text}
        </p>
      )}

      <dl className={styles.meta}>
        <dt className={styles.metaKey}>Taken</dt>
        <dd className={styles.metaValue}>{dateFormat.format(new Date(photo.takenAt))}</dd>

        <dt className={styles.metaKey}>Uploaded by</dt>
        <dd className={styles.metaValue}>{photo.uploaderName}</dd>

        <dt className={styles.metaKey}>Dimensions</dt>
        <dd className={styles.metaValue}>
          {photo.width} × {photo.height}
        </dd>

        {/* Read-only rows only for a viewer who cannot edit; for everyone else
            these same fields appear below as inputs. */}
        {!canEdit && photo.eventName && (
          <>
            <dt className={styles.metaKey}>Event</dt>
            <dd className={styles.metaValue}>{photo.eventName}</dd>
          </>
        )}

        {!canEdit && photo.academicYear && (
          <>
            <dt className={styles.metaKey}>Year</dt>
            <dd className={styles.metaValue}>{photo.academicYear}</dd>
          </>
        )}

        {!canEdit && photo.locationText && (
          <>
            <dt className={styles.metaKey}>Location</dt>
            <dd className={styles.metaValue}>{photo.locationText}</dd>
          </>
        )}
      </dl>

      {/*
        Tagging is open to anyone who can see the photo, so this sits outside the
        uploader-only block below. `tagPhoto` checks the photo against
        `visible_photos` for itself, so a tag cannot be used to probe an id.
      */}
      <div className={ui.field}>
        <span className={ui.label}>Tags</span>

        {tags.length === 0 ? (
          <p className={ui.hint} style={{ marginTop: 0 }}>
            None yet. Tags are shared — anyone in the batch who can see this photo can add one.
          </p>
        ) : (
          <div className={styles.tagRow}>
            {tags.map((tag) => (
              <span key={tag} className={styles.tagChip}>
                {tag}
                <button
                  type="button"
                  className={styles.tagRemove}
                  onClick={() => void changeTag(tag, false)}
                  aria-label={`Remove the tag ${tag}`}
                >
                  <Close size={10} />
                </button>
              </span>
            ))}
          </div>
        )}

        <form
          className={styles.tagAdd}
          onSubmit={(event) => {
            event.preventDefault();
            void changeTag(tagDraft, true);
            setTagDraft('');
          }}
        >
          <input
            className={ui.input}
            value={tagDraft}
            onChange={(event) => setTagDraft(event.target.value)}
            placeholder="Add a tag"
            aria-label="Add a tag"
            maxLength={60}
            list="tag-suggestions"
          />
          {/* Suggestions come from tags already on photos this viewer can see —
              never the whole tag table, which would leak the vocabulary of photos
              they cannot open. */}
          <datalist id="tag-suggestions">
            {suggestions
              .filter((name) => !tags.includes(name))
              .map((name) => (
                <option key={name} value={name} />
              ))}
          </datalist>
          <button
            className={`${ui.button} ${ui.buttonQuiet} ${ui.buttonSmall}`}
            type="submit"
            disabled={tagDraft.trim() === ''}
          >
            Add
          </button>
        </form>
      </div>

      {!canEdit ? (
        <>
          <p className={styles.asideTitle}>Who can see this</p>
          <p className={ui.hint} style={{ marginTop: 0 }}>
            {VISIBILITY_LABEL[photo.visibility] ?? photo.visibility}. Only {photo.uploaderName} can
            change that.
          </p>
        </>
      ) : (
        <>
          <label className={ui.field}>
            <span className={ui.label}>Caption</span>
            <textarea
              className={ui.textarea}
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
              maxLength={2000}
              placeholder="What was happening?"
            />
          </label>

          <label className={ui.field}>
            <span className={ui.label}>Event</span>
            <select
              className={ui.select}
              value={eventId}
              onChange={(event) => setEventId(event.target.value)}
              aria-label="Event"
            >
              <option value="">Not filed under an event</option>
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name}
                </option>
              ))}
            </select>
            {events.length === 0 && (
              <span className={ui.hint}>
                No events yet. Add one on the Events page and it will appear here.
              </span>
            )}
          </label>

          <div className={ui.row}>
            <label className={ui.field} style={{ flex: 1, minWidth: '7rem' }}>
              <span className={ui.label}>Year</span>
              <input
                className={ui.input}
                value={academicYear}
                onChange={(event) => setAcademicYear(event.target.value)}
                placeholder="2023-24"
                maxLength={40}
              />
            </label>

            <label className={ui.field} style={{ flex: 2, minWidth: '9rem' }}>
              <span className={ui.label}>Where</span>
              <input
                className={ui.input}
                value={locationText}
                onChange={(event) => setLocationText(event.target.value)}
                placeholder="Main quad, Block C…"
                maxLength={200}
              />
            </label>
          </div>

          <label className={ui.field}>
            <span className={ui.label}>Who can see this</span>
            <select
              className={ui.select}
              value={visibility}
              aria-label="Who can see this"
              onChange={(event) => {
                setVisibility(event.target.value as Visibility);
                setPrincipals(new Set());
              }}
            >
              {VISIBILITIES.map((value) => (
                <option key={value} value={value}>
                  {VISIBILITY_LABEL[value]}
                </option>
              ))}
            </select>
            <span className={ui.hint}>
              Changes take effect immediately — anyone who loses access loses it on their very next
              request.
            </span>
          </label>

          {needsPicker && (
            <div className={ui.field}>
              <span className={ui.label}>
                {visibility === 'group' ? 'Groups' : 'People'} · {principals.size} selected
              </span>

              {!directory ? (
                <p className={ui.hint} style={{ marginTop: 0 }}>
                  Loading…
                </p>
              ) : options.length === 0 ? (
                <p className={ui.hint} style={{ marginTop: 0 }}>
                  {visibility === 'group'
                    ? 'No groups yet. Create one first.'
                    : 'No other members in this batch yet.'}
                </p>
              ) : (
                <div className={styles.pickerList}>
                  {options.map((option) => {
                    const id = option.id;
                    const label = 'name' in option ? option.name : option.displayName;
                    const on = principals.has(id);

                    return (
                      <button
                        key={id}
                        type="button"
                        className={styles.pickerRow}
                        onClick={() => togglePrincipal(id)}
                        aria-pressed={on}
                      >
                        <span className={`${styles.pickerBox} ${on ? styles.pickerBoxOn : ''}`}>
                          {on && <Check size={10} />}
                        </span>
                        <span>{label}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              <span className={ui.hint}>
                This replaces the list entirely — whoever is not ticked here loses access.
              </span>
            </div>
          )}

          <div className={ui.row}>
            <button
              className={ui.button}
              onClick={() => void save()}
              disabled={saving || (needsPicker && principals.size === 0)}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <div className={ui.spacer} />
            <button
              className={`${ui.button} ${ui.buttonDanger} ${ui.buttonSmall}`}
              onClick={() => void remove()}
              disabled={saving}
              title="Moves this photo to Trash, where it can be restored"
            >
              <Trash size={13} />
              Delete
            </button>
          </div>

          <p className={ui.hint}>
            Deleting moves the photo to Trash. It disappears for everyone straight away, and can be
            restored from there.
          </p>
        </>
      )}

      {isAdmin && (
        <div className={ui.field}>
          <span className={ui.label}>Original file</span>
          <p className={ui.hint} style={{ marginTop: 0 }}>
            Members can view this photo but never download the original. Both actions below are
            recorded in the audit log against your account.
          </p>

          <div className={ui.row}>
            <a
              className={`${ui.button} ${ui.buttonQuiet} ${ui.buttonSmall}`}
              href={`/api/photos/${photo.id}/original`}
              download
            >
              <Download size={13} />
              Download original
            </a>
          </div>

          <select
            className={ui.select}
            value={grantTo}
            onChange={(event) => setGrantTo(event.target.value)}
            aria-label="Give one person a single download of this original"
          >
            <option value="">Give someone one download…</option>
            {(directory?.people ?? []).map((person) => (
              <option key={person.id} value={person.id}>
                {person.displayName}
              </option>
            ))}
          </select>

          {grantTo && (
            <>
              <input
                className={ui.input}
                value={grantReason}
                onChange={(event) => setGrantReason(event.target.value)}
                placeholder="Why (recorded with the grant)"
                maxLength={500}
              />
              <div className={ui.row}>
                <button
                  className={`${ui.button} ${ui.buttonSmall}`}
                  disabled={saving}
                  onClick={() => void issueGrant()}
                >
                  Issue grant
                </button>
              </div>
              <span className={ui.hint}>
                One download, valid for a day, then it is spent. It does not make the photo
                downloadable for anyone else.
              </span>
            </>
          )}
        </div>
      )}

    </aside>
  );
}
