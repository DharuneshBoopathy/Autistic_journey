'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Empty, Section } from '@/components/ui';
import ui from '@/components/ui.module.css';

type Invite = {
  id: string;
  email: string | null;
  roleGranted: string;
  expiresAt: string;
  maxUses: number;
  useCount: number;
  revokedAt: string | null;
  createdAt: string;
};

const dayFormat = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function describe(invite: Invite): { label: string; tone: 'success' | 'neutral' | 'danger' } {
  if (invite.revokedAt) return { label: 'revoked', tone: 'danger' };
  if (new Date(invite.expiresAt).getTime() < Date.now()) return { label: 'expired', tone: 'neutral' };
  if (invite.useCount >= invite.maxUses) return { label: 'used up', tone: 'neutral' };
  return { label: 'usable', tone: 'success' };
}

export function Invites({ invites }: { invites: Invite[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [days, setDays] = useState('14');
  const [uses, setUses] = useState('1');

  /**
   * The one plaintext code, held only in this component's state.
   *
   * It is never fetched again because it was never stored — the server keeps a hash.
   * Reloading this page loses it, which is the intended behaviour, not an oversight.
   */
  const [issued, setIssued] = useState<string | null>(null);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setIssued(null);

    try {
      const response = await fetch('/api/admin/invites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: email.trim() === '' ? null : email.trim(),
          roleGranted: role,
          expiresInDays: Number(days),
          maxUses: Number(uses),
        }),
      });

      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? 'Could not create that invite.');
        return;
      }

      setIssued(body.code);
      setEmail('');
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(inviteId: string) {
    setBusy(true);
    try {
      const response = await fetch('/api/admin/invites', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inviteId }),
      });
      if (!response.ok) {
        setError('Could not revoke that invite.');
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Section title="Issue an invite">
        <form onSubmit={create} className={ui.stack}>
          <div className={ui.row}>
            <label className={ui.field} style={{ flex: 2, minWidth: '14rem' }}>
              <span className={ui.label}>Tied to an email address (optional)</span>
              <input
                className={ui.input}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Anyone with the code, if left blank"
              />
            </label>

            <label className={ui.field} style={{ flex: 1, minWidth: '9rem' }}>
              <span className={ui.label}>Grants the role</span>
              <select
                className={ui.select}
                value={role}
                onChange={(event) => setRole(event.target.value)}
                aria-label="Role this invite grants"
              >
                <option value="member">Member</option>
                <option value="moderator">Moderator</option>
                <option value="admin">Admin</option>
              </select>
            </label>

            <label className={ui.field} style={{ flex: 1, minWidth: '7rem' }}>
              <span className={ui.label}>Expires in days</span>
              <input
                className={ui.input}
                type="number"
                min={1}
                max={90}
                value={days}
                onChange={(event) => setDays(event.target.value)}
              />
            </label>

            <label className={ui.field} style={{ flex: 1, minWidth: '7rem' }}>
              <span className={ui.label}>Uses</span>
              <input
                className={ui.input}
                type="number"
                min={1}
                max={100}
                value={uses}
                onChange={(event) => setUses(event.target.value)}
              />
            </label>
          </div>

          <div>
            <button className={ui.button} type="submit" disabled={busy}>
              {busy ? 'Issuing…' : 'Issue invite'}
            </button>
          </div>

          {error && (
            <p className={ui.error} role="alert">
              {error}
            </p>
          )}

          {issued && (
            <div className={ui.success}>
              <p>
                Copy this code now — it is not stored and cannot be shown again:{' '}
                <code className={ui.code}>{issued}</code>
              </p>
            </div>
          )}
        </form>
      </Section>

      <Section title="Issued">
        {invites.length === 0 ? (
          <Empty title="No invites yet">Nobody has been invited to this batch.</Empty>
        ) : (
          <div className={ui.list}>
            {invites.map((invite) => {
              const state = describe(invite);

              return (
                <div key={invite.id} className={ui.listRow}>
                  <div className={ui.listMain}>
                    <div className={ui.listTitle}>{invite.email ?? 'Anyone with the code'}</div>
                    <div className={ui.listMeta}>
                      {invite.roleGranted} · {invite.useCount}/{invite.maxUses} used · expires{' '}
                      {dayFormat.format(new Date(invite.expiresAt))}
                    </div>
                  </div>

                  <Badge tone={state.tone}>{state.label}</Badge>

                  {state.label === 'usable' && (
                    <button
                      className={`${ui.button} ${ui.buttonSmall} ${ui.buttonQuiet}`}
                      disabled={busy}
                      onClick={() => void revoke(invite.id)}
                    >
                      Revoke
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
