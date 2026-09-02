import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import { logoutAction } from '@/app/(auth)/actions';
import styles from '@/components/paper.module.css';

export const metadata: Metadata = { title: 'Gallery — The Autistic Journey' };

/**
 * Placeholder timeline. The real virtualised gallery lands in the next phase; this
 * exists so the authentication chain is exercised end to end.
 */
export default async function GalleryPage() {
  const user = await requireUser();

  return (
    <main id="main" style={{ maxWidth: '48rem', margin: '0 auto', padding: 'var(--space-12)' }}>
      <div className={styles.card}>
        <h2 className={styles.title}>Signed in</h2>
        <p className={styles.subtitle}>
          {user.displayName} · {user.email} · {user.role}
        </p>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-50)' }}>
          The gallery timeline is not built yet. No photographs should be uploaded to this
          instance.
        </p>
        <form action={logoutAction} style={{ marginTop: 'var(--space-6)' }}>
          <button type="submit" className={`${styles.button} ${styles.buttonSecondary}`}>
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
