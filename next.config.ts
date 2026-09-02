import type { NextConfig } from 'next';

/**
 * Baseline headers for every route.
 *
 * Content-Security-Policy is deliberately NOT here — it needs a fresh nonce per
 * request so that Next's inline hydration scripts are allowed to run, and static
 * headers cannot provide one. See `src/middleware.ts`.
 *
 * Note also the deliberate inversion of the reference portfolio's caching rule: it
 * cached `*.webp` for a year in a shared cache. Private photos must never enter a
 * shared cache, so image responses set `private, no-store` at the route handler.
 */
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  // A private archive should never be indexed, on any route, on any domain.
  { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive, nosnippet, noimageindex' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Never leak the framework version.
  poweredByHeader: false,

  // `sharp` is a native module; it must not be bundled into the server build.
  serverExternalPackages: ['sharp', 'postgres'],

  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
