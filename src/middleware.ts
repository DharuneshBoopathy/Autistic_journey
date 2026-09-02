import { NextResponse, type NextRequest } from 'next/server';

/**
 * Route gating and Content-Security-Policy.
 *
 * IMPORTANT — the route gating below is a redirect for user experience, **not** an
 * authorization control. It runs on the Edge runtime, where it can neither open a
 * database connection nor hash a token, so all it can check is whether a session
 * cookie is *present*. It cannot tell a valid session from an expired, revoked, or
 * entirely forged one.
 *
 * Real enforcement happens in the pages and route handlers themselves, via
 * `requireUser()` / `requireRole()` and the `visible_photos` predicate. Nothing in
 * the application trusts this file for access decisions.
 */

const PUBLIC_PATHS = ['/login', '/register'];

// `__Host-` in production, plain name over http in local development.
const SESSION_COOKIES = ['__Host-aj_session', 'aj_session'];

/**
 * Build a per-request CSP.
 *
 * This lives in middleware rather than `next.config.ts` because it needs a fresh
 * nonce for every response, and static headers cannot provide one.
 *
 * The nonce matters: Next.js emits inline bootstrap scripts to hydrate the page, so
 * a flat `script-src 'self'` blocks them and the application never becomes
 * interactive — server-rendered HTML appears, forms still submit as native POSTs,
 * and every client component silently does nothing. That failure is easy to miss
 * precisely because the page looks fine.
 *
 * `'strict-dynamic'` lets those nonced scripts load the chunks they need without
 * having to enumerate every bundle URL.
 */
function buildCsp(nonce: string, isDev: boolean): string {
  return [
    "default-src 'self'",
    // Next's dev server compiles with eval; production never needs it.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${isDev ? "'unsafe-eval'" : ''}`.trim(),
    // React injects inline styles during hydration, and there is no nonce hook for
    // them. Inline *styles* cannot execute code, so the risk is defacement rather
    // than script execution.
    "style-src 'self' 'unsafe-inline'",
    // blob: lets the uploader preview a chosen file before it leaves the browser.
    "img-src 'self' data: blob:",
    "font-src 'self'",
    // The archive talks to nothing but itself. No analytics, no third-party CDN.
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const hasSessionCookie = SESSION_COOKIES.some((name) => request.cookies.has(name));

  if (!isPublic && !hasSessionCookie) {
    /*
     * API routes answer with a status code, never a redirect to an HTML page.
     * Redirecting here would hand an XHR the login page with status 200, which the
     * caller would then try to parse as JSON — turning "you are signed out" into a
     * confusing parse error instead of a clear 401.
     */
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
    }

    const url = request.nextUrl.clone();
    url.pathname = '/login';
    // Preserve where they were heading, so sign-in can return them there. Only the
    // path and query are kept — never an absolute URL, which would make this an
    // open-redirect gadget.
    url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildCsp(nonce, process.env.NODE_ENV !== 'production');

  /*
   * Next reads the nonce back out of the request's own CSP header and stamps it onto
   * the scripts it emits, so it has to be set on the request as well as the response.
   */
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', csp);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set('content-security-policy', csp);
  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except Next's internals and static assets. The image-delivery
     * route (/api/photos/...) is deliberately included: it should answer an
     * anonymous request with 401 rather than serving bytes.
     */
    '/((?!_next/static|_next/image|favicon.ico|robots.txt).*)',
  ],
};
