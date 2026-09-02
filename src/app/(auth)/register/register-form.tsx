'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { registerAction, type ActionState } from '../actions';
import { PASSWORD_MIN_LENGTH } from '@/lib/password.client';
import styles from '@/components/paper.module.css';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.button} disabled={pending}>
      {pending ? 'Creating account…' : 'Create account'}
    </button>
  );
}

export function RegisterForm() {
  const [state, action] = useActionState<ActionState, FormData>(registerAction, {});

  return (
    <form action={action} noValidate>
      {state.error && (
        <p className={styles.error} role="alert" aria-live="polite">
          {state.error}
        </p>
      )}

      <label className={styles.field}>
        <span className={styles.label}>Invite code</span>
        <input
          className={`${styles.input} ${styles.code}`}
          name="inviteCode"
          required
          maxLength={64}
          placeholder="XXXX-XXXX-XXXX-XXXX"
          autoComplete="off"
          spellCheck={false}
          autoFocus
        />
        <span className={styles.hint}>Dashes and capitalisation don&rsquo;t matter.</span>
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Email</span>
        <input
          className={styles.input}
          type="email"
          name="email"
          autoComplete="email"
          required
          maxLength={320}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Display name</span>
        <input
          className={styles.input}
          name="displayName"
          autoComplete="name"
          required
          maxLength={80}
        />
        <span className={styles.hint}>How your name appears on photos you upload.</span>
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Password</span>
        <input
          className={styles.input}
          type="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          maxLength={512}
        />
        <span className={styles.hint}>
          At least {PASSWORD_MIN_LENGTH} characters. Length matters far more than symbols — a
          memorable phrase beats a short scramble.
        </span>
      </label>

      <Submit />
    </form>
  );
}
