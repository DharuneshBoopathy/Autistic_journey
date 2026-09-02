'use server';

import { and, eq, sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { z } from 'zod';
import { db, schema } from '@/db';
import { env } from '@/lib/env';
import { AuditAction, audit } from '@/lib/audit';
import { RateLimits, consumeRateLimit, resetRateLimit } from '@/lib/rate-limit';
import { hashPassword, validatePassword, verifyAgainstDummy, verifyPassword } from '@/lib/password';
import { createSession, destroySession, getSessionUser } from '@/lib/session';
import { hashIp, normalizeEmail } from '@/lib/tokens';
import { redeemInvite } from '@/lib/invites';

export type ActionState = { error?: string; notice?: string };

/**
 * One message for every failure mode of login.
 *
 * "No such account", "wrong password" and "account suspended" must be
 * indistinguishable, or the form becomes an oracle for who is in this batch — which
 * for a private archive leaks membership, not merely an account.
 */
const LOGIN_FAILED = 'Incorrect email or password.';

const MAX_FAILED_LOGINS = 10;
const LOCKOUT_MINUTES = 15;

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown';
}

const loginSchema = z.object({
  email: z.string().min(3).max(320),
  password: z.string().min(1).max(512),
});

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) return { error: LOGIN_FAILED };

  const email = normalizeEmail(parsed.data.email);
  const ip = await clientIp();
  const ipHash = hashIp(ip, env.SESSION_SECRET);

  // Two limiters: per-address slows a targeted guess, per-IP catches one password
  // sprayed across many addresses.
  const byIp = await consumeRateLimit(`login:ip:${ipHash}`, RateLimits.LOGIN_PER_IP);
  const byEmail = await consumeRateLimit(`login:email:${email}`, RateLimits.LOGIN_PER_EMAIL);
  if (!byIp.allowed || !byEmail.allowed) {
    const wait = Math.max(byIp.retryAfterSeconds, byEmail.retryAfterSeconds);
    return { error: `Too many attempts. Try again in ${Math.ceil(wait / 60)} minutes.` };
  }

  const [user] = await db
    .select({
      id: schema.users.id,
      passwordHash: schema.users.passwordHash,
      status: schema.users.status,
      lockedUntil: schema.users.lockedUntil,
      failedLoginCount: schema.users.failedLoginCount,
    })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  // Spend the same Argon2 work whether or not the account exists, so response time
  // does not distinguish the two.
  if (!user) {
    await verifyAgainstDummy(parsed.data.password);
    await audit({ action: AuditAction.LOGIN_FAILED, ipHash, metadata: { reason: 'no_such_user' } });
    return { error: LOGIN_FAILED };
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    await verifyAgainstDummy(parsed.data.password);
    await audit({
      action: AuditAction.LOGIN_FAILED,
      actorId: user.id,
      actorEmail: email,
      ipHash,
      metadata: { reason: 'locked' },
    });
    return { error: LOGIN_FAILED };
  }

  const correct = await verifyPassword(user.passwordHash, parsed.data.password);

  if (!correct) {
    const next = user.failedLoginCount + 1;
    const lock = next >= MAX_FAILED_LOGINS;

    await db
      .update(schema.users)
      .set({
        failedLoginCount: next,
        lockedUntil: lock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
      })
      .where(eq(schema.users.id, user.id));

    await audit({
      action: lock ? AuditAction.ACCOUNT_LOCKED : AuditAction.LOGIN_FAILED,
      actorId: user.id,
      actorEmail: email,
      ipHash,
      metadata: { reason: 'bad_password', failedCount: next },
    });

    return { error: LOGIN_FAILED };
  }

  /*
   * The password was correct, so we may safely be specific about account state:
   * telling someone who already holds the credentials that their account is awaiting
   * approval is good UX and reveals nothing they did not already know. Revealing the
   * same to someone who guessed wrong would be the enumeration leak we avoid above.
   */
  if (user.status !== 'active') {
    await db
      .update(schema.users)
      .set({ failedLoginCount: 0, lockedUntil: null })
      .where(eq(schema.users.id, user.id));

    await audit({
      action: AuditAction.LOGIN_FAILED,
      actorId: user.id,
      actorEmail: email,
      ipHash,
      metadata: { reason: `status_${user.status}` },
    });

    if (user.status === 'pending') {
      return { error: 'Your account is awaiting approval by an administrator.' };
    }
    return { error: 'This account is not active. Contact an administrator.' };
  }

  await db
    .update(schema.users)
    .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() })
    .where(eq(schema.users.id, user.id));

  await resetRateLimit(`login:email:${email}`);

  const sessionId = await createSession(user.id);
  await audit({
    action: AuditAction.LOGIN_SUCCEEDED,
    actorId: user.id,
    actorEmail: email,
    targetType: 'session',
    targetId: sessionId,
    ipHash,
  });

  redirect('/gallery');
}

const registerSchema = z.object({
  inviteCode: z.string().min(1).max(64),
  email: z.string().email().max(320),
  displayName: z.string().trim().min(1).max(80),
  password: z.string().min(1).max(512),
});

/**
 * Registration is gated twice: a valid, unexpired, unexhausted invite code, and then
 * an administrator approving the resulting account. A leaked code alone does not
 * grant access to a single photograph.
 */
export async function registerAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = registerSchema.safeParse({
    inviteCode: formData.get('inviteCode'),
    email: formData.get('email'),
    displayName: formData.get('displayName'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Please check the form and try again.' };
  }

  const ip = await clientIp();
  const ipHash = hashIp(ip, env.SESSION_SECRET);

  const limited = await consumeRateLimit(`register:ip:${ipHash}`, RateLimits.REGISTER_PER_IP);
  const codeLimited = await consumeRateLimit(
    `invite:ip:${ipHash}`,
    RateLimits.INVITE_REDEEM_PER_IP,
  );
  if (!limited.allowed || !codeLimited.allowed) {
    return { error: 'Too many attempts. Please try again later.' };
  }

  const passwordProblem = validatePassword(parsed.data.password);
  if (passwordProblem) return { error: passwordProblem };

  const email = normalizeEmail(parsed.data.email);
  const passwordHash = await hashPassword(parsed.data.password);

  try {
    // Invite consumption and account creation share one transaction: if account
    // creation fails, the invite use is rolled back rather than silently burned.
    const outcome = await db.transaction(async (tx) => {
      const redeemed = await redeemInvite(tx, parsed.data.inviteCode, email);
      if (!redeemed.ok) return { ok: false as const, reason: redeemed.reason };

      const [created] = await tx
        .insert(schema.users)
        .values({
          batchId: redeemed.invite.batchId,
          email,
          passwordHash,
          displayName: parsed.data.displayName,
          role: redeemed.invite.roleGranted,
          status: 'pending', // the second gate
        })
        .returning({ id: schema.users.id });

      return { ok: true as const, userId: created!.id, inviteId: redeemed.invite.id };
    });

    if (!outcome.ok) {
      await audit({
        action: AuditAction.INVITE_REJECTED,
        ipHash,
        metadata: { reason: outcome.reason },
      });
      // One message for every invite failure — "expired" vs "already used" vs "no
      // such code" would let someone probe which codes exist.
      return { error: 'That invite code is not valid.' };
    }

    await audit({
      action: AuditAction.USER_REGISTERED,
      actorId: outcome.userId,
      actorEmail: email,
      targetType: 'user',
      targetId: outcome.userId,
      ipHash,
      metadata: { inviteId: outcome.inviteId },
    });
    await audit({
      action: AuditAction.INVITE_REDEEMED,
      actorId: outcome.userId,
      actorEmail: email,
      targetType: 'invite',
      targetId: outcome.inviteId,
      ipHash,
    });
  } catch (error) {
    // The unique index on users.email is the real guard against duplicate accounts;
    // this catch turns its violation into an unrevealing message.
    if (error instanceof Error && /users_email_key|duplicate key/i.test(error.message)) {
      return { error: 'That invite code is not valid.' };
    }
    throw error;
  }

  redirect('/register/submitted');
}

export async function logoutAction(): Promise<void> {
  const user = await getSessionUser();
  await destroySession();

  if (user) {
    await audit({
      action: AuditAction.LOGOUT,
      actorId: user.id,
      actorEmail: user.email,
      targetType: 'session',
      targetId: user.sessionId,
    });
  }

  redirect('/login');
}

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(512),
  newPassword: z.string().min(1).max(512),
});

export async function changePasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get('currentPassword'),
    newPassword: formData.get('newPassword'),
  });
  if (!parsed.success) return { error: 'Please check the form and try again.' };

  const problem = validatePassword(parsed.data.newPassword);
  if (problem) return { error: problem };

  const [row] = await db
    .select({ passwordHash: schema.users.passwordHash })
    .from(schema.users)
    .where(eq(schema.users.id, user.id))
    .limit(1);

  if (!row || !(await verifyPassword(row.passwordHash, parsed.data.currentPassword))) {
    return { error: 'Your current password is incorrect.' };
  }

  await db
    .update(schema.users)
    .set({ passwordHash: await hashPassword(parsed.data.newPassword), updatedAt: new Date() })
    .where(eq(schema.users.id, user.id));

  // Every other session dies with the old password, so a session stolen earlier does
  // not survive the change that was meant to lock the thief out.
  await db
    .update(schema.sessions)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(schema.sessions.userId, user.id), sql`${schema.sessions.id} <> ${user.sessionId}`),
    );

  await audit({
    action: AuditAction.PASSWORD_CHANGED,
    actorId: user.id,
    actorEmail: user.email,
    targetType: 'user',
    targetId: user.id,
  });

  return { notice: 'Password changed. Other sessions have been signed out.' };
}

/*
 * NOTE — nothing else may be exported from this file.
 *
 * Every export of a `'use server'` module is compiled into a callable RPC endpoint
 * with a stable id, reachable by anyone who can reach the app. An exported helper is
 * therefore a public, unauthenticated HTTP entry point, whatever its name suggests.
 *
 * This file previously re-exported `revokeAllSessions(userId)` for convenience,
 * which published exactly that: "terminate every session of any user id you name",
 * with no session check of its own. Server-side helpers belong in `src/lib/*` and
 * must be imported from there.
 *
 * Each action below re-establishes the caller's identity itself — via
 * `getSessionUser()` — and never trusts an id supplied by the client.
 */
