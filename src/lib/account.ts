import 'server-only';
import { and, desc, eq, gt, isNull, ne } from 'drizzle-orm';
import { db, schema } from '@/db';
import { AuditAction, audit } from '@/lib/audit';
import type { SessionUser } from '@/lib/session';

/**
 * A member's own account: the sessions they hold, and the ability to end them.
 *
 * Every function here takes the resolved `SessionUser` and scopes its query to
 * `user.id`. None of them accept a user id from a caller, which is the whole point:
 * "sign this session out" must never be reachable as "sign *that* person's session
 * out" by changing a number in a request.
 */

/*
 * A member with more live sessions than this has a different problem than a long
 * list — and the page's job is to make "sign the others out" easy, not to enumerate
 * every one. The count of what was left out is shown rather than silently dropped.
 */
const MAX_LISTED = 50;

export type SessionRow = {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  /** A rough description of the client, from its user-agent string. */
  device: string;
  /** Whether this is the session making the request. */
  current: boolean;
};

/**
 * A short, honest description of a client.
 *
 * User-agent strings are self-reported and easily forged, so this is a memory aid —
 * "that was my phone last Tuesday" — not evidence. It is deliberately coarse: a full
 * UA string tells a member almost nothing and tells anyone reading over their
 * shoulder rather a lot.
 */
function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';

  const platform = /iPhone|iPad/i.test(userAgent)
    ? 'iOS'
    : /Android/i.test(userAgent)
      ? 'Android'
      : /Macintosh|Mac OS/i.test(userAgent)
        ? 'Mac'
        : /Windows/i.test(userAgent)
          ? 'Windows'
          : /Linux/i.test(userAgent)
            ? 'Linux'
            : null;

  // Order matters: Edge and Chrome both claim Safari, and Edge also claims Chrome.
  const browser = /Edg\//i.test(userAgent)
    ? 'Edge'
    : /Firefox\//i.test(userAgent)
      ? 'Firefox'
      : /Chrome\//i.test(userAgent)
        ? 'Chrome'
        : /Safari\//i.test(userAgent)
          ? 'Safari'
          : null;

  if (platform && browser) return `${browser} on ${platform}`;
  return browser ?? platform ?? 'Unknown device';
}

/** The caller's own live sessions, most recently used first. */
export async function listSessions(
  user: SessionUser,
): Promise<{ sessions: SessionRow[]; total: number }> {
  const rows = await db
    .select({
      id: schema.sessions.id,
      createdAt: schema.sessions.createdAt,
      lastSeenAt: schema.sessions.lastSeenAt,
      expiresAt: schema.sessions.expiresAt,
      userAgent: schema.sessions.userAgent,
    })
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.userId, user.id),
        isNull(schema.sessions.revokedAt),
        gt(schema.sessions.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(schema.sessions.lastSeenAt));

  /*
   * The current session is pinned to the top rather than left to sort by last-used.
   * It is the one row whose meaning depends on being identifiable, and it is the one
   * row that must not fall off the end of a truncated list.
   */
  const ordered = [
    ...rows.filter((row) => row.id === user.sessionId),
    ...rows.filter((row) => row.id !== user.sessionId),
  ];

  return {
    total: rows.length,
    sessions: ordered.slice(0, MAX_LISTED).map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      device: describeDevice(row.userAgent),
      current: row.id === user.sessionId,
    })),
  };
}

export type RevokeResult = { ok: true; revoked: number } | { ok: false; reason: 'not_found' };

/**
 * End one of the caller's own sessions.
 *
 * The `userId` clause is what makes the session id safe to accept from the client:
 * an id belonging to somebody else matches nothing, and comes back as `not_found`
 * rather than as a refusal that would confirm the id is real.
 */
export async function revokeSession(
  user: SessionUser,
  sessionId: string,
): Promise<RevokeResult> {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return { ok: false, reason: 'not_found' };

  const revoked = await db
    .update(schema.sessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.sessions.id, sessionId),
        eq(schema.sessions.userId, user.id),
        isNull(schema.sessions.revokedAt),
      ),
    )
    .returning({ id: schema.sessions.id });

  if (revoked.length === 0) return { ok: false, reason: 'not_found' };

  await audit({
    action: AuditAction.SESSION_REVOKED,
    actorId: user.id,
    actorEmail: user.email,
    targetType: 'session',
    targetId: sessionId,
    metadata: { scope: sessionId === user.sessionId ? 'self.current' : 'self.one' },
  });

  return { ok: true, revoked: revoked.length };
}

/**
 * End every session except this one.
 *
 * The answer to "I think someone else is signed in as me": it keeps the member
 * signed in on the device in front of them and turns everything else off. Pair it
 * with a password change, which is what stops the other party simply signing back in.
 */
export async function revokeOtherSessions(user: SessionUser): Promise<number> {
  const revoked = await db
    .update(schema.sessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.sessions.userId, user.id),
        ne(schema.sessions.id, user.sessionId),
        isNull(schema.sessions.revokedAt),
      ),
    )
    .returning({ id: schema.sessions.id });

  if (revoked.length > 0) {
    await audit({
      action: AuditAction.SESSION_REVOKED,
      actorId: user.id,
      actorEmail: user.email,
      targetType: 'user',
      targetId: user.id,
      metadata: { scope: 'self.others', count: revoked.length },
    });
  }

  return revoked.length;
}
