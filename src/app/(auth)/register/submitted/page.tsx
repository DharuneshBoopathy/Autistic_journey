import type { Metadata } from 'next';
import Link from 'next/link';
import styles from '@/components/paper.module.css';

export const metadata: Metadata = { title: 'Account requested — The Autistic Journey' };

export default function SubmittedPage() {
  return (
    <>
      <div className={styles.card}>
        <h2 className={styles.title}>Request received</h2>
        <p className={styles.subtitle}>
          Your invite code was accepted and your account has been created, but it is not active
          yet — an administrator reviews every new account before it can reach the archive.
        </p>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-50)' }}>
          You&rsquo;ll be able to sign in once it&rsquo;s approved. Trying before then will tell
          you it&rsquo;s still pending.
        </p>
      </div>

      <p className={styles.footNote}>
        <Link href="/login">Back to sign in</Link>
      </p>
    </>
  );
}
