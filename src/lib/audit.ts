import { db, schema, type Db, type Tx } from '@/db';

/**
 * Audit actions.
 *
 * Anything that changes who can reach what — accounts, roles, visibility, ACLs,
 * downloads, deletions — must be recorded. The table is append-only (enforced by
 * trigger and by revoked grants), so these entries survive a compromised app.
 */
export const AuditAction = {
  // Authentication
  LOGIN_SUCCEEDED: 'auth.login.succeeded',
  LOGIN_FAILED: 'auth.login.failed',
  LOGOUT: 'auth.logout',
  ACCOUNT_LOCKED: 'auth.account.locked',
  PASSWORD_CHANGED: 'auth.password.changed',
  SESSION_REVOKED: 'auth.session.revoked',

  // Registration and approval
  INVITE_CREATED: 'invite.created',
  INVITE_REDEEMED: 'invite.redeemed',
  INVITE_REVOKED: 'invite.revoked',
  INVITE_REJECTED: 'invite.rejected',
  USER_REGISTERED: 'user.registered',
  USER_APPROVED: 'user.approved',
  USER_REJECTED: 'user.rejected',
  USER_SUSPENDED: 'user.suspended',
  USER_REINSTATED: 'user.reinstated',
  USER_ROLE_CHANGED: 'user.role.changed',

  // Photos
  PHOTO_UPLOADED: 'photo.uploaded',
  PHOTO_VISIBILITY_CHANGED: 'photo.visibility.changed',
  PHOTO_ACL_CHANGED: 'photo.acl.changed',
  PHOTO_DELETED: 'photo.deleted',
  PHOTO_RESTORED: 'photo.restored',
  PHOTO_PURGED: 'photo.purged',
  ORIGINAL_DOWNLOADED: 'photo.original.downloaded',
  DOWNLOAD_GRANT_ISSUED: 'photo.download_grant.issued',

  // Organisation
  GROUP_MEMBER_ADDED: 'group.member.added',
  GROUP_MEMBER_REMOVED: 'group.member.removed',
  ALBUM_VISIBILITY_CHANGED: 'album.visibility.changed',
} as const;

export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export type AuditEntry = {
  action: AuditAction;
  actorId?: string | null;
  /**
   * The actor's address at the time of the event, captured into the row.
   *
   * `actorId` is not a foreign key — audit rows must survive deletion of the account
   * they describe — so without this, an entry whose user was later purged would read
   * as an unresolvable UUID. Pass it wherever the acting user is known.
   */
  actorEmail?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  ipHash?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
};

/**
 * Record an auditable action.
 *
 * Deliberately never throws: an audit write failing must not take down the request
 * that triggered it, and must certainly not roll back a security action such as
 * revoking a session. Failures are logged loudly instead.
 *
 * The trade-off is explicit — availability of the action over guaranteed capture of
 * its log line. Where an entry must be atomic with its action (issuing a download
 * grant, for instance), pass the surrounding transaction as `tx`.
 */
export async function audit(entry: AuditEntry, tx?: Db | Tx): Promise<void> {
  try {
    await (tx ?? db).insert(schema.auditLogs).values({
      action: entry.action,
      actorId: entry.actorId ?? null,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      ipHash: entry.ipHash ?? null,
      userAgent: entry.userAgent ?? null,
      metadata: entry.actorEmail
        ? { ...entry.metadata, actor: entry.actorEmail }
        : (entry.metadata ?? null),
    });
  } catch (error) {
    console.error('[audit] failed to record', entry.action, error);
  }
}
