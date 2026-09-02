'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './shell.module.css';

/**
 * A navigation link that knows whether it is the current section.
 *
 * Client-side because it reads the pathname; it is the only interactive part of the
 * shell, so the rest of the header stays a server component.
 */
export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  // Prefix match so /albums/<id> keeps "Albums" marked as current.
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      className={`${styles.navLink} ${active ? styles.navActive : ''}`}
      aria-current={active ? 'page' : undefined}
    >
      {children}
    </Link>
  );
}
