'use client';

import { useActionState } from 'react';
import { changePasswordAction, type ActionState } from '@/app/(auth)/actions';
import ui from '@/components/ui.module.css';

/**
 * Change your own password.
 *
 * The current password is required and checked server-side, so a borrowed session
 * alone cannot lock its owner out — whoever holds the cookie still has to know the
 * password to replace it. A successful change revokes every other session.
 */
export function ChangePassword() {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    changePasswordAction,
    {},
  );

  return (
    <form action={action} className={ui.stack}>
      <label className={ui.field}>
        <span className={ui.label}>Current password</span>
        <input
          className={ui.input}
          type="password"
          name="currentPassword"
          autoComplete="current-password"
          required
          maxLength={512}
        />
      </label>

      <label className={ui.field}>
        <span className={ui.label}>New password</span>
        <input
          className={ui.input}
          type="password"
          name="newPassword"
          autoComplete="new-password"
          required
          maxLength={512}
        />
        <span className={ui.hint}>
          Long beats complicated. A phrase you will remember is stronger than a short string of
          symbols, and this archive is meant to outlast the semester.
        </span>
      </label>

      {state.error && (
        <p className={ui.error} role="alert">
          {state.error}
        </p>
      )}
      {state.notice && (
        <p className={ui.success} role="status">
          {state.notice}
        </p>
      )}

      <div>
        <button className={ui.button} type="submit" disabled={pending}>
          {pending ? 'Changing…' : 'Change password'}
        </button>
      </div>
    </form>
  );
}
