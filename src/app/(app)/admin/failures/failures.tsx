'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { FailedPhoto } from '@/lib/admin';
import ui from '@/components/ui.module.css';

const stamp = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export function Failures({ failures }: { failures: FailedPhoto[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function retry(photoId: string) {
    setBusy(photoId);
    setError(null);

    try {
      const response = await fetch('/api/admin/failures', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ photoId }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? 'Could not queue that retry.');
        return;
      }

      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {error && (
        <p className={ui.error} role="alert">
          {error}
        </p>
      )}

      <div className={ui.list}>
        {failures.map((failure) => (
          <div key={failure.id} className={ui.listRow}>
            <div className={ui.listMain}>
              <div className={ui.listTitle}>{failure.originalFilename ?? 'Unnamed file'}</div>
              <div className={ui.listMeta}>
                {failure.uploaderName} · {stamp.format(new Date(failure.uploadedAt))} ·{' '}
                {failure.attempts} {failure.attempts === 1 ? 'attempt' : 'attempts'}
                {failure.error ? ` · ${failure.error}` : ''}
              </div>
            </div>

            <button
              className={`${ui.button} ${ui.buttonSmall}`}
              disabled={busy === failure.id}
              onClick={() => void retry(failure.id)}
            >
              {busy === failure.id ? 'Queuing…' : 'Retry'}
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
