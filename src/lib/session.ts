import 'server-only';
import { cookies, headers } from 'next/headers';
import { and, eq, isNull, gt } from 'drizzle-orm';
import { db, schema } from '@/db';
import { env } from '@/lib/env';
import { generateToken, hashIp, hashToken } from '@/lib/tokens';

export const SESSION_COOKIE = '__Host-aj_session';

/** Absolute session lifetime. Re-authentication is required after this. */
const SESSION_TTL_DAYS = 30;

/**
 * How stale `last_seen_at` may get before we write it again. Without this every
 * request would issue a write, which at gallery scroll rates is a lot of pointless
 * traffic to the primary.
 */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export type SessionUser = {
  id: string;
  batchId: string;
  email: string;
  displayName: string;
  role: 'member' | 'moderator' | 'admin';
  status: 'pending' | 'active' | 'suspended' | 'deactivated';
  sessionId: string;
};

/**
 * The `__Host-` cookie prefix is enforced by the browser: it will only accept the
 * cookie if it is Secure, has Path=/, and carries no Domain attribute. That makes
 * it impossible for a subdomain — including one taken over by an attacker — to set
 * or overwrite this session cookie.
 *
 * The prefix requires HTTPS, so in local development (plain http) we fall back to
 * an unprefixed name. `env` refuses a non-https APP_ORIGIN in production, so this
 * cannot silently weaken a real deployment.
 */
export function sessionCookieName(): string {
  return env.APP_ORIGIN.startsWith('https://') ? SESSION_COOKIE : 'aj_session';
}

function cookieOptions(expiresAt: Date) {
  return {
    httpOnly: true, // unreadable from JavaScript, so XSS cannot exfiltrate it
    secure: env.APP_ORIGIN.startsWith('https://'),
    sameSite: 'lax' as const, // blocks cross-site POSTs; see also the CSRF origin check
    path: '/',
    expires: expiresAt,
  };
}

async function requestContext() {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown';
  return {
    ipHash: hashIp(ip, env.SESSION_SECRET),
    userAgent: h.get('user-agent')?.slice(0, 512) ?? null,
  };
}

/** Issue a session and set its cookie. Returns the session id for audit logging. */
export async function createSession(userId: string): Promise<string> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
  const { ipHash, userAgent } = await requestContext();

  const [row] = await db
    .insert(schema.sessions)
    .values({ userId, tokenHash: hashToken(token), expiresAt, ipHash, userAgent })
    .returning({ id: schema.sessions.id });

  const jar = await cookies();
  jar.set(sessionCookieName(), token, cookieOptions(expiresAt));

  return row!.id;
}

/**
 * Resolve the current session, or null.
 *
 * The status check lives in the query, not in a caller's `if`: a suspended or
 * deactivated account stops resolving immediately, without waiting for its session
 * to expire. This is why sessions are server-side rather than self-contained JWTs —
 * revocation has to take effect now.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(sessionCookieName())?.value;
  if (!token) return null;

  const [row] = await db
    .select({
      sessionId: schema.sessions.id,
      lastSeenAt: schema.sessions.lastSeenAt,
      id: schema.users.id,
      batchId: schema.users.batchId,
      email: schema.users.email,
      displayName: schema.users.displayName,
      role: schema.users.role,
      status: schema.users.status,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(
      and(
        eq(schema.sessions.tokenHash, hashToken(token)),
        isNull(schema.sessions.revokedAt),
        gt(schema.sessions.expiresAt, new Date()),
        eq(schema.users.status, 'active'),
        isNull(schema.users.deactivatedAt),
      ),
    )
    .limit(1);

  if (!row) return null;

  if (Date.now() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db
      .update(schema.sessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(schema.sessions.id, row.sessionId));
  }

  return {
    id: row.id,
    batchId: row.batchId,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    status: row.status,
    sessionId: row.sessionId,
  };
}

/** Revoke the current session and clear its cookie. */
export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const name = sessionCookieName();
  const token = jar.get(name)?.value;

  if (token) {
    await db
      .update(schema.sessions)
      .set({ revokedAt: new Date() })
      .where(eq(schema.sessions.tokenHash, hashToken(token)));
  }

  jar.delete(name);
}

/**
 * Revoke every session for a user. Called when an admin suspends an account, and
 * after a password change, so a stolen session cannot outlive the response to it.
 */
export async function revokeAllSessions(userId: string): Promise<number> {
  const revoked = await db
    .update(schema.sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt)))
    .returning({ id: schema.sessions.id });

  return revoked.length;
}

/*
 * Session pruning deliberately lives in `src/worker/maintenance.ts`, not here.
 * This module carries `import 'server-only'`, which throws outside Next's runtime —
 * so anything the standalone worker needs cannot live behind that guard.
 */
