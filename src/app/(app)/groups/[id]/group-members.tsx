'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Empty, Section } from '@/components/ui';
import ui from '@/components/ui.module.css';

type Member = { id: string; displayName: string; role: string };
type Person = { id: string; displayName: string };

/**
 * Group membership.
 *
 * The add and remove controls are hidden from people who cannot use them, but that
 * is presentation only: `/api/groups/[id]/members` re-resolves the caller's standing
 * in the group from stored rows and refuses on its own account.
 */
export function GroupMembers({
  groupId,
  canManage,
  isOwner,
  initialMembers,
}: {
  groupId: string;
  canManage: boolean;
  isOwner: boolean;
  initialMembers: Member[];
}) {
  const router = useRouter();
  const [members, setMembers] = useState(initialMembers);
  /*
   * `null` until the directory has been fetched — distinct from an empty list.
   * Without that distinction the page claims "everyone is already in this group"
   * for the moment before the names arrive, which is not merely a blank state but a
   * confidently wrong one.
   */
  const [people, setPeople] = useState<Person[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!canManage) return;

    let cancelled = false;
    void (async () => {
      const response = await fetch('/api/directory');
      if (!response.ok || cancelled) return;

      const body = await response.json();
      setPeople(body.people);
    })();

    return () => {
      cancelled = true;
    };
  }, [canManage]);

  async function change(method: 'POST' | 'DELETE', userId: string) {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/groups/${groupId}/members`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? 'That did not work.');
        return;
      }

      if (method === 'DELETE') {
        setMembers((current) => current.filter((m) => m.id !== userId));
      } else {
        const person = people?.find((p) => p.id === userId);
        if (person) {
          setMembers((current) =>
            current.some((m) => m.id === userId)
              ? current
              : [...current, { id: person.id, displayName: person.displayName, role: 'member' }],
          );
        }
      }
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  async function removeGroup() {
    if (!confirm('Delete this group? Photos shared with it stop being reachable through it.')) {
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`/api/groups/${groupId}`, { method: 'DELETE' });
      if (!response.ok) {
        setError('Could not delete that group.');
        return;
      }
      router.push('/groups');
    } finally {
      setBusy(false);
    }
  }

  const memberIds = new Set(members.map((m) => m.id));
  const needle = filter.trim().toLowerCase();
  const addable = (people ?? [])
    .filter((p) => !memberIds.has(p.id))
    .filter((p) => needle === '' || p.displayName.toLowerCase().includes(needle));

  return (
    <>
      <Section title="Members" aside={<span className={ui.listMeta}>{members.length}</span>}>
        {members.length === 0 ? (
          <Empty title="Nobody here">This group has no members yet.</Empty>
        ) : (
          <div className={ui.list}>
            {members.map((member) => (
              <div key={member.id} className={ui.listRow}>
                <div className={ui.listMain}>
                  <div className={ui.listTitle}>{member.displayName}</div>
                </div>

                {member.role !== 'member' && <Badge tone="accent">{member.role}</Badge>}

                {canManage && member.role !== 'owner' && (
                  <button
                    className={`${ui.button} ${ui.buttonSmall} ${ui.buttonQuiet}`}
                    disabled={busy}
                    onClick={() => void change('DELETE', member.id)}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      {canManage && (
        <Section
          title="Add someone"
          aside={
            <input
              className={ui.input}
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Find a name"
              aria-label="Filter batch members by name"
              style={{ width: '12rem' }}
            />
          }
        >
          {people === null ? (
            <p className={ui.hint}>Loading the batch directory…</p>
          ) : addable.length === 0 ? (
            <p className={ui.hint}>
              {needle === ''
                ? 'Everyone in the batch is already in this group.'
                : 'Nobody left to add matches that.'}
            </p>
          ) : (
            <div className={ui.list}>
              {addable.map((person) => (
                <div key={person.id} className={ui.listRow}>
                  <div className={ui.listMain}>
                    <div className={ui.listTitle}>{person.displayName}</div>
                  </div>
                  <button
                    className={`${ui.button} ${ui.buttonSmall}`}
                    disabled={busy}
                    onClick={() => void change('POST', person.id)}
                  >
                    Add
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {error && (
        <p className={ui.error} role="alert">
          {error}
        </p>
      )}

      {isOwner && (
        <p style={{ marginTop: 'var(--s7)' }}>
          <button
            className={`${ui.button} ${ui.buttonDanger}`}
            disabled={busy}
            onClick={() => void removeGroup()}
          >
            Delete this group
          </button>
        </p>
      )}
    </>
  );
}
