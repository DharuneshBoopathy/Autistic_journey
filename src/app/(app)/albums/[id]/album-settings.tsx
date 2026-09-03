'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import ui from '@/components/ui.module.css';

/**
 * Album name, description and visibility, for its owner.
 *
 * Only rendered when the server said the viewer may manage this album. That is a
 * convenience, not the control — `PATCH /api/albums/[id]` re-reads the album's
 * `owner_id` and refuses regardless of what the page chose to show.
 */
export function AlbumSettings({
  id,
  name: initialName,
  description: initialDescription,
  visibility: initialVisibility,
}: {
  id: string;
  name: string;
  description: string | null;
  visibility: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? '');
  const [visibility, setVisibility] = useState(initialVisibility);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/albums/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || initialName,
          description: description.trim() === '' ? null : description.trim(),
          visibility,
        }),
      });

      if (!response.ok) {
        setError('Could not save those changes.');
        return;
      }

      setOpen(false);
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm('Delete this album? The photos in it are not deleted.')) return;

    setBusy(true);
    try {
      const response = await fetch(`/api/albums/${id}`, { method: 'DELETE' });
      if (!response.ok) {
        setError('Could not delete that album.');
        return;
      }
      router.push('/albums');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <p style={{ marginBottom: 'var(--s6)' }}>
        <button
          className={`${ui.button} ${ui.buttonQuiet} ${ui.buttonSmall}`}
          onClick={() => setOpen(true)}
        >
          Album settings
        </button>
      </p>
    );
  }

  return (
    <form onSubmit={save} className={`${ui.panel} ${ui.panelPad}`} style={{ marginBottom: 'var(--s6)' }}>
      <div className={ui.stack}>
        <label className={ui.field}>
          <span className={ui.label}>Name</span>
          <input
            className={ui.input}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={160}
          />
        </label>

        <label className={ui.field}>
          <span className={ui.label}>Description</span>
          <textarea
            className={ui.textarea}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={1000}
            rows={2}
          />
        </label>

        <label className={ui.field}>
          <span className={ui.label}>Who can open this album</span>
          <select
            className={ui.select}
            value={visibility}
            onChange={(event) => setVisibility(event.target.value)}
            aria-label="Who can open this album"
          >
            <option value="private">Only me</option>
            <option value="batch">Everyone in the batch</option>
          </select>
          <span className={ui.hint}>
            Opening an album is not the same as seeing what is in it. Each photo keeps its own
            visibility, so sharing the album does not share a single photo that was not already
            shared.
          </span>
        </label>

        {error && (
          <p className={ui.error} role="alert">
            {error}
          </p>
        )}

        <div className={ui.row}>
          <button className={ui.button} type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button
            className={`${ui.button} ${ui.buttonQuiet}`}
            type="button"
            onClick={() => setOpen(false)}
            disabled={busy}
          >
            Cancel
          </button>
          <span className={ui.spacer} />
          <button
            className={`${ui.button} ${ui.buttonDanger}`}
            type="button"
            onClick={() => void remove()}
            disabled={busy}
          >
            Delete album
          </button>
        </div>
      </div>
    </form>
  );
}
