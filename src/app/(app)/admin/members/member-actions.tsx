'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { MemberRow } from '@/lib/admin';
import { Badge } from '@/components/ui';
import ui from '@/components/ui.module.css';

const dayFormat = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

type Action =
  | { action: 'approve' }
  | { action: 'reject' }
  | { action: 'suspend' }
  | { action: 'reinstate' }
  | { action: 'setRole'; role: string };

/**
 * Send one action and report what the server said.
 *
 * Errors are shown rather than swallowed: "You cannot suspend your own account" is a
 * real answer from the server, and hiding it would leave an admin clicking a button
 * that silently does nothing.
 */
function useMemberAction(onDone: () => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (memberId: string, body: Action) => {
    setBusy(memberId);
    setError(null);

    try {
      const response = await fetch(`/api/admin/members/${memberId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload.error ?? 'That did not work.');
        return;
      }

      onDone();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(null);
    }
  };

  return { busy, error, run };
}

/** The approval queue: approve lets someone in, reject closes the account. */
export function PendingMembers({ members }: { members: MemberRow[] }) {
  const router = useRouter();
  const { busy, error, run } = useMemberAction(() => router.refresh());

  return (
    <>
      {error && (
        <p className={ui.error} role="alert">
          {error}
        </p>
      )}

      <div className={ui.list}>
        {members.map((member) => (
          <div key={member.id} className={ui.listRow}>
            <div className={ui.listMain}>
              <div className={ui.listTitle}>{member.displayName}</div>
              <div className={ui.listMeta}>
                {member.email} · registered {dayFormat.format(new Date(member.createdAt))}
              </div>
            </div>

            <button
              className={`${ui.button} ${ui.buttonSmall}`}
              disabled={busy === member.id}
              onClick={() => void run(member.id, { action: 'approve' })}
            >
              Approve
            </button>
            <button
              className={`${ui.button} ${ui.buttonSmall} ${ui.buttonQuiet}`}
              disabled={busy === member.id}
              onClick={() => void run(member.id, { action: 'reject' })}
            >
              Reject
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

const STATUS_TONE: Record<string, 'success' | 'notice' | 'danger' | 'neutral'> = {
  active: 'success',
  pending: 'notice',
  suspended: 'danger',
  deactivated: 'neutral',
};

/** The full roster, with role and suspension controls. */
export function MemberList({ members, selfId }: { members: MemberRow[]; selfId: string }) {
  const router = useRouter();
  const { busy, error, run } = useMemberAction(() => router.refresh());

  return (
    <>
      {error && (
        <p className={ui.error} role="alert">
          {error}
        </p>
      )}

      <div className={ui.list}>
        {members.map((member) => {
          const isSelf = member.id === selfId;

          return (
            <div key={member.id} className={ui.listRow}>
              <div className={ui.listMain}>
                <div className={ui.listTitle}>
                  {member.displayName}
                  {isSelf && ' — you'}
                </div>
                <div className={ui.listMeta}>
                  {member.email} · {member.photoCount.toLocaleString()}{' '}
                  {member.photoCount === 1 ? 'photo' : 'photos'} ·{' '}
                  {member.lastLoginAt
                    ? `last seen ${dayFormat.format(new Date(member.lastLoginAt))}`
                    : 'never signed in'}
                </div>
              </div>

              <Badge tone={STATUS_TONE[member.status] ?? 'neutral'}>{member.status}</Badge>

              {/* An admin cannot change their own role or suspend themselves — the
                  server refuses either way, so the controls are not offered. */}
              <select
                className={ui.select}
                value={member.role}
                disabled={isSelf || busy === member.id}
                onChange={(event) =>
                  void run(member.id, { action: 'setRole', role: event.target.value })
                }
                aria-label={`Role for ${member.displayName}`}
                style={{ width: 'auto' }}
              >
                <option value="member">Member</option>
                <option value="moderator">Moderator</option>
                <option value="admin">Admin</option>
              </select>

              {member.status === 'suspended' ? (
                <button
                  className={`${ui.button} ${ui.buttonSmall}`}
                  disabled={busy === member.id}
                  onClick={() => void run(member.id, { action: 'reinstate' })}
                >
                  Reinstate
                </button>
              ) : (
                member.status === 'active' &&
                !isSelf && (
                  <button
                    className={`${ui.button} ${ui.buttonSmall} ${ui.buttonQuiet}`}
                    disabled={busy === member.id}
                    onClick={() => void run(member.id, { action: 'suspend' })}
                  >
                    Suspend
                  </button>
                )
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
