import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { RegisterForm } from './register-form';
import styles from '@/components/paper.module.css';

export const metadata: Metadata = { title: 'Create account — The Autistic Journey' };

export default async function RegisterPage() {
  if (await getSessionUser()) redirect('/gallery');

  return (
    <>
      <div className={styles.card}>
        <h2 className={styles.title}>Create account</h2>
        <p className={styles.subtitle}>
          You need an invite code from an administrator. Your account is then reviewed before
          it is activated.
        </p>
        <RegisterForm />
      </div>

      <p className={styles.footNote}>
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </>
  );
}
