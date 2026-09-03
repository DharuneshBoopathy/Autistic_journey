'use client';

import { useState } from 'react';
import type { SessionRow } from '@/lib/account';
import { Badge, Empty } from '@/components/ui';
import ui from '@/components/ui.module.css';

const stamp = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * Live sessions, with the ability to end them.
 *
 * The device column comes from the user-agent string, which is self-reported and
 * easily forged. It is a memory aid — "that was my phone last Tuesday" — not
 * evidence, and the page says so rather than presenting it as a security log.
 */
export function Sessions({ initial, total }: { initial: SessionRow[]; total: number }) {
  const [sessions, setSessions] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function revoke(body: Record<string, string>, busyKey: string) {
    setBusy(busyKey);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch('/api/account/sessions', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        setError('That session could not be ended.');
        return;
      }

      const { revoked } = await response.json();

      if (body.scope === 'others') {
        setSessions((current) => current.filter((s) => s.current));
        setNotice(
          revoked === 0
            ? 'There was nothing else signed in.'
            : `Signed out ${revoked} other ${revoked === 1 ? 'session' : 'sessions'}.`,
        );
      } else {
        setSessions((current) => current.filter((s) => s.id !== body.sessionId));
        setNotice('Signed that session out.');
      }
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(null);
    }
  }

  // Counted from the server's total, not the visible rows: the button ends every
  // other session, including the ones the list truncated.
  const others = Math.max(total - 1, sessions.filter((s) => !s.current).length);

  return (
    <>
      {error && (
        <p className={ui.error} role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className={ui.success} role="status">
          {notice}
        </p>
      )}

      {sessions.length === 0 ? (
        <Empty title="Nothing signed in">This should not be possible while you are reading it.</Empty>
      ) : (
        <div className={ui.list}>
          {sessions.map((session) => (
            <div key={session.id} className={ui.listRow}>
              <div className={ui.listMain}>
                <div className={ui.listTitle}>{session.device}</div>
                <div className={ui.listMeta}>
                  Last used {stamp.format(new Date(session.lastSeenAt))} · signed in{' '}
                  {stamp.format(new Date(session.createdAt))}
                </div>
              </div>

              {session.current && <Badge tone="success">This device</Badge>}

              {!session.current && (
                <button
                  className={`${ui.button} ${ui.buttonSmall} ${ui.buttonQuiet}`}
                  disabled={busy === session.id}
                  onClick={() => void revoke({ sessionId: session.id }, session.id)}
                >
                  Sign out
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {total > sessions.length && (
        <p className={ui.hint}>
          {total - sessions.length} older {total - sessions.length === 1 ? 'session is' : 'sessions are'} not
          shown. Signing the others out below ends those too.
        </p>
      )}

      <p className={ui.hint}>
        The device names come from what each browser reports about itself, which anything can
        claim. Treat them as a reminder of which device was which, not as proof.
      </p>

      {others > 0 && (
        <p style={{ marginTop: 'var(--s5)' }}>
          <button
            className={`${ui.button} ${ui.buttonDanger}`}
            disabled={busy === 'others'}
            onClick={() => void revoke({ scope: 'others' }, 'others')}
          >
            Sign out the other {others === 1 ? 'session' : `${others} sessions`}
          </button>
          <span className={ui.hint}>
            If you think someone else is signed in as you, do this and then change your password —
            ending the session alone does not stop them signing back in.
          </span>
        </p>
      )}
    </>
  );
}
