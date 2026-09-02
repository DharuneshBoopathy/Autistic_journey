'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import ui from '@/components/ui.module.css';

/** Create a group. The creator is its first member and its owner. */
export function NewGroup() {
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
      const response = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });

      if (!response.ok) {
        setError('Could not create that group.');
        return;
      }

      const { id } = await response.json();
      router.push(`/groups/${id}`);
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
        placeholder="New group name"
        aria-label="New group name"
        maxLength={120}
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
