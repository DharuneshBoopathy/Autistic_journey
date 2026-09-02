import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { env } from '@/lib/env';
import { getSessionUser, type SessionUser } from '@/lib/session';

export type Role = 'member' | 'moderator' | 'admin';

/** Roles are a total order: an admin can do anything a moderator can, and so on. */
const RANK: Record<Role, number> = { member: 0, moderator: 1, admin: 2 };

export function hasRole(user: { role: Role }, required: Role): boolean {
  return RANK[user.role] >= RANK[required];
}

/**
 * The standard entry point for any authenticated page or action.
 *
 * Redirects rather than returning null, so a caller cannot accidentally continue
 * with an unauthenticated user by ignoring the result.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return user;
}

/**
 * Require a minimum role.
 *
 * A member reaching an admin route gets 404, not 403 — a 403 confirms the route
 * exists and that they simply lack the rank, which maps out the admin surface for
 * anyone probing. There is nothing to gain from telling them.
 */
export async function requireRole(required: Role): Promise<SessionUser> {
  const user = await requireUser();
  if (!hasRole(user, required)) {
    const { notFound } = await import('next/navigation');
    notFound();
  }
  return user;
}

/** Like requireUser, but for route handlers that must answer with a status code. */
export async function getApiUser(): Promise<SessionUser | null> {
  return getSessionUser();
}

/**
 * Reject state-changing requests that did not originate from this site.
 *
 * SameSite=Lax already blocks cross-site form POSTs, and Next verifies the Origin
 * on Server Actions. This is the third layer, for hand-written route handlers:
 * defence that does not depend on the browser's cookie policy being implemented
 * the way we expect.
 *
 * A missing Origin *and* Referer is rejected for unsafe methods rather than waved
 * through — the common case for both being absent is a non-browser client.
 */
export async function assertSameOrigin(): Promise<boolean> {
  const h = await headers();
  const origin = h.get('origin');

  if (origin) return origin === env.APP_ORIGIN;

  const referer = h.get('referer');
  if (referer) {
    try {
      return new URL(referer).origin === env.APP_ORIGIN;
    } catch {
      return false;
    }
  }

  return false;
}
