'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import ui from '@/components/ui.module.css';

/**
 * One tab in the admin bar.
 *
 * `exact` exists for the overview tab: a prefix match on `/admin` would mark it
 * current on every sub-page, which is exactly the wrong signal.
 */
export function TabLink({
  href,
  exact,
  children,
}: {
  href: string;
  exact?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      className={`${ui.tab} ${active ? ui.tabActive : ''}`}
      aria-current={active ? 'page' : undefined}
    >
      {children}
    </Link>
  );
}
