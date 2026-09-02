import 'server-only';
import { NextResponse } from 'next/server';
import { assertSameOrigin, getApiUser } from '@/lib/auth';
import type { SessionUser } from '@/lib/session';

/**
 * Shared entry checks for JSON route handlers.
 *
 * Every mutating route needs the same three things — a same-origin check, a session,
 * and no-store on the way out. Repeating them by hand is how one route eventually
 * ends up missing one, so they live here.
 */

/** Private data must never sit in a shared cache. */
export const NO_STORE = { 'cache-control': 'private, no-store' } as const;

export function json(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: { ...NO_STORE, ...(init?.headers ?? {}) },
  });
}

export type Authorized = { user: SessionUser; error?: never };
export type Unauthorized = { user?: never; error: NextResponse };

/**
 * Resolve the caller for a route handler.
 *
 * `mutating` adds the same-origin check. It is not applied to reads because a GET
 * changes nothing, and requiring an Origin header there would break ordinary
 * navigation.
 */
export async function requireApiUser(
  options: { mutating?: boolean } = {},
): Promise<Authorized | Unauthorized> {
  if (options.mutating && !(await assertSameOrigin())) {
    return { error: json({ error: 'Cross-origin request refused.' }, { status: 403 }) };
  }

  const user = await getApiUser();
  if (!user) return { error: json({ error: 'Not signed in.' }, { status: 401 }) };

  return { user };
}

/**
 * Map a domain failure to a status code.
 *
 * `not_found` and `forbidden` deliberately collapse to the same 404: a 403 confirms
 * the resource exists, which is the enumeration leak the visibility model exists to
 * prevent. The distinction is preserved in the audit log, not in the response.
 */
export function failureStatus(reason: string): number {
  switch (reason) {
    case 'not_found':
    case 'forbidden':
      return 404;
    case 'invalid':
    case 'invalid_member':
    case 'invalid_photo':
    case 'invalid_principal':
      return 422;
    case 'name_taken':
      return 409;
    default:
      return 400;
  }
}

export function parseBody<T>(
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } },
  raw: unknown,
): T | null {
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
