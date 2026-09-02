import type { NextConfig } from 'next';

/**
 * Content-Security-Policy.
 *
 * `'unsafe-inline'` is present for styles only — Next injects inline <style> tags
 * during hydration. Scripts get no such exemption. `frame-ancestors 'none'` is the
 * modern equivalent of X-Frame-Options (which is also sent, for older agents).
 */
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  // blob: is required so the client can render local previews of files the user
  // has selected for upload, before they leave the browser.
  "img-src 'self' data: blob:",
  "font-src 'self'",
  // The archive talks to nothing but itself. No analytics, no third-party CDN.
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join('; ');

/**
 * Baseline headers for every route.
 *
 * Note the deliberate inversion of the reference portfolio's caching rule: it cached
 * `*.webp` for a year in a shared cache. Private photos must never enter a shared
 * cache, so image responses set `private, no-store` at the route handler instead.
 */
const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
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
