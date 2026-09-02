import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { LoginForm } from './login-form';
import styles from '@/components/paper.module.css';

export const metadata: Metadata = { title: 'Sign in — The Autistic Journey' };

export default async function LoginPage() {
  // Already signed in? Don't show the form again.
  if (await getSessionUser()) redirect('/gallery');

  return (
    <>
      <div className={styles.card}>
        <h2 className={styles.title}>Sign in</h2>
        <p className={styles.subtitle}>Access is limited to approved batch members.</p>
        <LoginForm />
      </div>

      <p className={styles.footNote}>
        Have an invite code? <Link href="/register">Create your account</Link>
      </p>
    </>
  );
}
