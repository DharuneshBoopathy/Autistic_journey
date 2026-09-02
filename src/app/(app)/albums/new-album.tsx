'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import ui from '@/components/ui.module.css';

/**
 * Create an album from a single line.
 *
 * Deliberately just a name: an album starts private, and its description and
 * visibility are edited on the album's own page, where the consequences of the
 * choice are visible. A modal asking for three fields up front would be more
 * ceremony for less information.
 */
export function NewAlbum() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/albums', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });

      if (!response.ok) {
        setError('Could not create that album.');
        return;
      }

      const { id } = await response.json();
      router.push(`/albums/${id}`);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={create} className={ui.row}>
      <input
        className={ui.input}
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="New album name"
        aria-label="New album name"
        maxLength={160}
        style={{ width: '14rem' }}
      />
      <button className={ui.button} type="submit" disabled={busy || name.trim() === ''}>
        {busy ? 'Creating…' : 'Create'}
      </button>
      {error && (
        <span className={ui.error} role="alert">
          {error}
        </span>
      )}
    </form>
  );
}
