'use client';

import { useCallback, useState } from 'react';
import type { AuditRow } from '@/lib/admin';
import { Empty } from '@/components/ui';
import ui from '@/components/ui.module.css';

const stamp = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/**
 * Actions worth filtering by, in the order an administrator would look for them.
 *
 * Not every action in the log — the list is a shortcut, not a schema. An action
 * missing from it still appears in the unfiltered log.
 */
const FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Everything' },
  { value: 'photo.visibility.changed', label: 'Visibility changed' },
  { value: 'photo.acl.changed', label: 'Sharing changed' },
  { value: 'photo.deleted', label: 'Photos deleted' },
  { value: 'photo.restored', label: 'Photos restored' },
  { value: 'photo.purged', label: 'Photos purged' },
  { value: 'photo.original.downloaded', label: 'Originals downloaded' },
  { value: 'photo.download_grant.issued', label: 'Download grants issued' },
  { value: 'auth.login.failed', label: 'Failed sign-ins' },
  { value: 'auth.account.locked', label: 'Accounts locked' },
  { value: 'user.approved', label: 'Members approved' },
  { value: 'user.suspended', label: 'Members suspended' },
  { value: 'user.role.changed', label: 'Roles changed' },
  { value: 'group.member.added', label: 'Group members added' },
  { value: 'group.member.removed', label: 'Group members removed' },
];

/**
 * Plain-English names for every action the log can hold.
 *
 * Wider than the filter list on purpose: the filter offers the actions worth
 * narrowing to, while this names everything that can appear in a row. An action
 * missing from here still renders — as its raw identifier, which is ugly but never
 * wrong.
 */
const LABEL: Record<string, string> = {
  'auth.login.succeeded': 'Signed in',
  'auth.login.failed': 'Sign-in failed',
  'auth.logout': 'Signed out',
  'auth.account.locked': 'Account locked',
  'auth.password.changed': 'Password changed',
  'auth.session.revoked': 'Sessions revoked',
  'invite.created': 'Invite created',
  'invite.redeemed': 'Invite redeemed',
  'invite.revoked': 'Invite revoked',
  'invite.rejected': 'Invite rejected',
  'user.registered': 'Registered',
  'user.approved': 'Member approved',
  'user.rejected': 'Registration rejected',
  'user.suspended': 'Member suspended',
  'user.reinstated': 'Member reinstated',
  'user.role.changed': 'Role changed',
  'photo.uploaded': 'Photo uploaded',
  'photo.visibility.changed': 'Visibility changed',
  'photo.acl.changed': 'Sharing changed',
  'photo.deleted': 'Photo deleted',
  'photo.restored': 'Photo restored',
  'photo.purged': 'Photo purged',
  'photo.original.downloaded': 'Original downloaded',
  'photo.download_grant.issued': 'Download grant issued',
  'group.member.added': 'Group member added',
  'group.member.removed': 'Group member removed',
  'album.visibility.changed': 'Album visibility changed',
};

/** Render the captured metadata compactly, without pretending to interpret it. */
function summarise(metadata: Record<string, unknown> | null): string {
  if (!metadata) return '';

  return Object.entries(metadata)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
    .join(' · ');
}

const PAGE_SIZE = 100;

export function AuditLog({ initial }: { initial: AuditRow[] }) {
  const [entries, setEntries] = useState<AuditRow[]>(initial);
  const [action, setAction] = useState('');
  const [loading, setLoading] = useState(false);
  const [exhausted, setExhausted] = useState(initial.length < PAGE_SIZE);

  /**
   * Fetch one page.
   *
   * With `before`, the result is appended; without, it replaces what is on screen —
   * which is what changing the filter needs. Both are driven by an event, not by an
   * effect reacting to state, so there is no render that shows the wrong list first.
   */
  const load = useCallback(async (nextAction: string, before?: number) => {
    setLoading(true);

    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (nextAction) params.set('action', nextAction);
      if (before) params.set('before', String(before));

      const response = await fetch(`/api/admin/audit?${params}`);
      if (!response.ok) return;

      const body: { entries: AuditRow[] } = await response.json();
      setEntries((current) => (before ? [...current, ...body.entries] : body.entries));
      setExhausted(body.entries.length < PAGE_SIZE);
    } finally {
      setLoading(false);
    }
  }, []);

  const oldest = entries[entries.length - 1]?.id;

  return (
    <>
      <label className={ui.field} style={{ maxWidth: '20rem' }}>
        <span className={ui.label}>Show</span>
        <select
          className={ui.select}
          value={action}
          onChange={(event) => {
            setAction(event.target.value);
            void load(event.target.value);
          }}
          disabled={loading}
        >
          {FILTERS.map((filter) => (
            <option key={filter.value} value={filter.value}>
              {filter.label}
            </option>
          ))}
        </select>
      </label>

      {entries.length === 0 && !loading ? (
        <Empty title="Nothing recorded">No entries match that filter yet.</Empty>
      ) : (
        <div className={ui.list}>
          {entries.map((entry) => (
            <div key={entry.id} className={ui.listRow}>
              <div className={ui.listMain}>
                <div className={ui.listTitle}>
                  {LABEL[entry.action] ?? entry.action}
                  {entry.actorEmail ? ` — ${entry.actorEmail}` : ''}
                </div>
                <div className={ui.listMeta}>
                  {stamp.format(new Date(entry.createdAt))}
                  {entry.targetType ? ` · ${entry.targetType}` : ''}
                  {entry.targetId ? ` ${entry.targetId}` : ''}
                  {summarise(entry.metadata) ? ` · ${summarise(entry.metadata)}` : ''}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <p style={{ marginTop: 'var(--s5)' }}>
        {loading ? (
          <span className={ui.hint}>Loading…</span>
        ) : exhausted ? (
          <span className={ui.hint}>That is the whole log for this filter.</span>
        ) : (
          <button
            className={`${ui.button} ${ui.buttonQuiet}`}
            onClick={() => oldest && void load(action, oldest)}
          >
            Load older entries
          </button>
        )}
      </p>
    </>
  );
}
