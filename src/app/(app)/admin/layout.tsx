import { notFound } from 'next/navigation';
import { hasRole, requireUser } from '@/lib/auth';
import { TabLink } from './tab-link';
import ui from '@/components/ui.module.css';

/**
 * The admin gate.
 *
 * This is a convenience for navigation, not the control: every admin route handler
 * and every function in `src/lib/admin.ts` checks the role again for itself. A
 * non-admin who guessed a URL would reach a page whose data all came back empty or
 * refused. `notFound()` rather than a 403 keeps the section's existence unconfirmed.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (!hasRole(user, 'admin')) notFound();

  return (
    <div className={ui.page}>
      <nav className={ui.tabs} aria-label="Administration">
        <TabLink href="/admin" exact>
          Overview
        </TabLink>
        <TabLink href="/admin/members">Members</TabLink>
        <TabLink href="/admin/invites">Invites</TabLink>
        <TabLink href="/admin/failures">Failures</TabLink>
        <TabLink href="/admin/downloads">Downloads</TabLink>
        <TabLink href="/admin/audit">Audit log</TabLink>
      </nav>

      {children}
    </div>
  );
}
