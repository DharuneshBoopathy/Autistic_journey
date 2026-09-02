import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { hasRole } from '@/lib/auth';
import { logoutAction } from '@/app/(auth)/actions';
import styles from '@/components/gallery.module.css';


/**
 * Shell for every authenticated page.
 *
 * `requireUser()` here is convenience, not the control: each page and route handler
 * re-establishes identity for itself, so a layout that failed to render would not
 * leave anything exposed.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link href="/gallery" className={styles.wordmark} style={{ textDecoration: 'none' }}>
          The Autistic Journey
        </Link>

        <nav style={{ display: 'flex', gap: 'var(--space-4)', fontSize: 'var(--text-sm)' }}>
          <Link href="/gallery">Timeline</Link>
          <Link href="/upload">Upload</Link>
          {hasRole(user, 'admin') && <Link href="/admin">Admin</Link>}
        </nav>

        <div className={styles.headerSpacer} />

        <span className={styles.who}>{user.displayName}</span>
        <form action={logoutAction}>
          <button type="submit" className={styles.smallButton}>
            Sign out
          </button>
        </form>
      </header>

      {/* Full width and allowed to shrink, so the timeline grid gets the whole
          viewport rather than the narrow measure the auth cards use. */}
      <main id="main" style={{ flex: 1, minHeight: 0, width: '100%' }}>
        {children}
      </main>
    </div>
  );
}
