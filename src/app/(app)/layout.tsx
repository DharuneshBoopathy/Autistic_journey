import Link from 'next/link';
import { hasRole, requireUser } from '@/lib/auth';
import { logoutAction } from '@/app/(auth)/actions';
import { NavLink } from '@/components/nav-link';
import styles from '@/components/shell.module.css';

/**
 * Shell for every authenticated page.
 *
 * `requireUser()` here is convenience, not the control: each page and route handler
 * re-establishes identity for itself, so a layout that failed to render would not
 * leave anything exposed.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  // Two letters from the display name. No generated avatar or identicon — the
  // archive knows a name, and pretending to more than that is decoration.
  const initials = user.displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link href="/gallery" className={styles.wordmark}>
          <span>The Autistic Journey</span>
          <span className={styles.wordmarkSlash}>/</span>
          <span className={styles.wordmarkSub}>Gallery</span>
        </Link>

        <nav className={styles.nav} aria-label="Sections">
          <NavLink href="/gallery">Timeline</NavLink>
          <NavLink href="/albums">Albums</NavLink>
          <NavLink href="/groups">Groups</NavLink>
          <NavLink href="/events">Events</NavLink>
          <NavLink href="/upload">Upload</NavLink>
          <NavLink href="/trash">Trash</NavLink>
          {hasRole(user, 'admin') && <NavLink href="/admin">Admin</NavLink>}
        </nav>

        <div className={styles.spacer} />

        <div className={styles.identity}>
          {/* The name and initials are the way in to the account screen — the place
              people look for "change my password" without being told. */}
          <Link href="/account" className={styles.identityLink}>
            <span className={styles.who}>{user.displayName}</span>
            <span className={styles.initials} aria-hidden="true">
              {initials || '?'}
            </span>
            <span className={styles.srOnly}>Your account</span>
          </Link>
          <form action={logoutAction}>
            <button type="submit" className={styles.signOut}>
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main id="main" className={styles.main}>
        {children}
      </main>
    </div>
  );
}
