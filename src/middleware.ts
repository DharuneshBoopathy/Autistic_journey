import { NextResponse, type NextRequest } from 'next/server';

/**
 * Route gating.
 *
 * IMPORTANT — this middleware is a redirect for user experience, **not** an
 * authorization control. It runs on the Edge runtime, where it can neither open a
 * database connection nor hash a token, so all it can check is whether a session
 * cookie is *present*. It cannot tell a valid session from an expired, revoked, or
 * entirely forged one.
 *
 * Real enforcement happens in the pages and route handlers themselves, via
 * `requireUser()` / `requireRole()` and the `visible_photos` predicate. Nothing in
 * the application trusts this file for access decisions — deleting it would cost
 * some redirect polish and no security.
 */

const PUBLIC_PATHS = ['/login', '/register'];

// `__Host-` in production, plain name over http in local development.
const SESSION_COOKIES = ['__Host-aj_session', 'aj_session'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const hasSessionCookie = SESSION_COOKIES.some((name) => request.cookies.has(name));

  if (!isPublic && !hasSessionCookie) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    // Preserve where they were heading, so sign-in can return them there. Only the
    // path and query are kept — never an absolute URL, which would make this an
    // open-redirect gadget.
    url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Everything except Next's internals and static assets. The image-delivery
     * route (/api/photos/...) is deliberately included: it should redirect an
     * anonymous browser rather than serve it a 401 body.
     */
    '/((?!_next/static|_next/image|favicon.ico|robots.txt).*)',
  ],
};
