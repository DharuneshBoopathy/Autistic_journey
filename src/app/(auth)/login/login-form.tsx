'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { loginAction, type ActionState } from '../actions';
import styles from '@/components/paper.module.css';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.button} disabled={pending}>
      {pending ? 'Signing in…' : 'Sign in'}
    </button>
  );
}

export function LoginForm() {
  const [state, action] = useActionState<ActionState, FormData>(loginAction, {});

  return (
    <form action={action} noValidate>
      {state.error && (
        // aria-live so the failure is announced, not just shown.
        <p className={styles.error} role="alert" aria-live="polite">
          {state.error}
        </p>
      )}

      <label className={styles.field}>
        <span className={styles.label}>Email</span>
        <input
          className={styles.input}
          type="email"
          name="email"
          autoComplete="email"
          required
          maxLength={320}
          autoFocus
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Password</span>
        <input
          className={styles.input}
          type="password"
          name="password"
          autoComplete="current-password"
          required
          maxLength={512}
        />
      </label>

      <Submit />
    </form>
  );
}
