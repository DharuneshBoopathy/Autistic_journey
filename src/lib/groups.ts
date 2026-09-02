import 'server-only';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, schema, type Tx } from '@/db';
import { AuditAction, audit } from '@/lib/audit';
import { hasRole } from '@/lib/auth';
import type { SessionUser } from '@/lib/session';

/**
 * Groups — named sets of batch members, used as sharing targets.
 *
 * A group is an *addressing* convenience, never a grant in itself. Adding someone to
 * a group gives them access to photos already shared with that group, which is the
 * point; but nothing here bypasses `visible_photos`, and a group cannot reach across
 * batches.
 */

export type GroupFailure = 'not_found' | 'forbidden' | 'invalid_member' | 'name_taken';
export type GroupResult<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; reason: GroupFailure };

export type GroupSummary = {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  memberCount: number;
  viewerIsMember: boolean;
  viewerCanManage: boolean;
};

const uuidish = /^[0-9a-f-]{36}$/i;

/**
 * Who may change a group: its owner, a member holding `owner`/`admin` in the group,
 * or a site admin. Checked from stored rows, never from the request.
 */
async function canManage(
  tx: Tx | typeof db,
  user: SessionUser,
  groupId: string,
): Promise<{ batchId: string } | null> {
  const [group] = await tx
    .select({ id: schema.groups.id, batchId: schema.groups.batchId, ownerId: schema.groups.ownerId })
    .from(schema.groups)
    .where(
      and(
        eq(schema.groups.id, groupId),
        eq(schema.groups.batchId, user.batchId),
        isNull(schema.groups.deletedAt),
      ),
    )
    .limit(1);

  if (!group) return null;
  if (group.ownerId === user.id || hasRole(user, 'admin')) return { batchId: group.batchId };

  const [membership] = await tx
    .select({ role: schema.groupMembers.role })
    .from(schema.groupMembers)
    .where(
      and(eq(schema.groupMembers.groupId, groupId), eq(schema.groupMembers.userId, user.id)),
    )
    .limit(1);

  return membership && membership.role !== 'member' ? { batchId: group.batchId } : null;
}

/** Groups in the viewer's batch, with membership counts. */
export async function listGroups(user: SessionUser): Promise<GroupSummary[]> {
  const rows = await db.execute<{
    id: string;
    name: string;
    description: string | null;
    owner_id: string;
    member_count: number;
    viewer_is_member: boolean;
    viewer_role: string | null;
  }>(sql`
    SELECT g.id, g.name, g.description, g.owner_id,
           (SELECT count(*)::int FROM group_members m WHERE m.group_id = g.id) AS member_count,
           EXISTS (SELECT 1 FROM group_members m
                    WHERE m.group_id = g.id AND m.user_id = ${user.id}::uuid) AS viewer_is_member,
           (SELECT m.role::text FROM group_members m
             WHERE m.group_id = g.id AND m.user_id = ${user.id}::uuid) AS viewer_role
      FROM groups g
     WHERE g.batch_id = ${user.batchId}::uuid AND g.deleted_at IS NULL
     ORDER BY g.name
  `);

  return Array.from(rows).map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    ownerId: r.owner_id,
    memberCount: Number(r.member_count),
    viewerIsMember: r.viewer_is_member,
    viewerCanManage:
      r.owner_id === user.id || hasRole(user, 'admin') || (r.viewer_role !== null && r.viewer_role !== 'member'),
  }));
}

/** Members of a group. Visible to anyone in the batch — a group is not a secret. */
export async function listGroupMembers(
  user: SessionUser,
  groupId: string,
): Promise<GroupResult<Array<{ id: string; displayName: string; role: string }>>> {
  if (!uuidish.test(groupId)) return { ok: false, reason: 'not_found' };

  const [group] = await db
    .select({ id: schema.groups.id })
    .from(schema.groups)
    .where(
      and(
        eq(schema.groups.id, groupId),
        eq(schema.groups.batchId, user.batchId),
        isNull(schema.groups.deletedAt),
      ),
    )
    .limit(1);

  if (!group) return { ok: false, reason: 'not_found' };

  const rows = await db
    .select({
      id: schema.users.id,
      displayName: schema.users.displayName,
      role: schema.groupMembers.role,
    })
    .from(schema.groupMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.groupMembers.userId))
    .where(eq(schema.groupMembers.groupId, groupId));

  return { ok: true, value: rows };
}

export async function createGroup(
  user: SessionUser,
  input: { name: string; description?: string | null },
): Promise<GroupResult<{ id: string }>> {
  const name = input.name.trim().slice(0, 120);
  if (!name) return { ok: false, reason: 'name_taken' };

  const created = await db.transaction(async (tx) => {
    const [group] = await tx
      .insert(schema.groups)
      .values({
        batchId: user.batchId,
        name,
        description: input.description?.slice(0, 1000) ?? null,
        ownerId: user.id,
      })
      .returning({ id: schema.groups.id });

    // The creator is a member from the start; a group whose owner is not in it is a
    // confusing state that every caller would otherwise have to remember to avoid.
    await tx.insert(schema.groupMembers).values({
      groupId: group!.id,
      userId: user.id,
      role: 'owner',
      addedBy: user.id,
    });

    return group!.id;
  });

  return { ok: true, value: { id: created } };
}

export async function renameGroup(
  user: SessionUser,
  groupId: string,
  input: { name?: string; description?: string | null },
): Promise<GroupResult> {
  if (!uuidish.test(groupId)) return { ok: false, reason: 'not_found' };

  const allowed = await canManage(db, user, groupId);
  if (!allowed) return { ok: false, reason: 'not_found' };

  await db
    .update(schema.groups)
    .set({
      ...(input.name !== undefined && { name: input.name.trim().slice(0, 120) }),
      ...(input.description !== undefined && {
        description: input.description?.slice(0, 1000) ?? null,
      }),
    })
    .where(eq(schema.groups.id, groupId));

  return { ok: true, value: undefined };
}

/**
 * Soft-delete a group.
 *
 * Photos shared with it stay `group`-visible but resolve to nobody, because the
 * predicate joins through `group_members` and a deleted group keeps no live
 * membership path. That is the safe direction to fail: deleting a group narrows
 * access, never widens it.
 */
export async function deleteGroup(user: SessionUser, groupId: string): Promise<GroupResult> {
  if (!uuidish.test(groupId)) return { ok: false, reason: 'not_found' };

  const [group] = await db
    .select({ ownerId: schema.groups.ownerId })
    .from(schema.groups)
    .where(
      and(
        eq(schema.groups.id, groupId),
        eq(schema.groups.batchId, user.batchId),
        isNull(schema.groups.deletedAt),
      ),
    )
    .limit(1);

  // Deleting is owner-or-admin only, a stricter bar than managing membership.
  if (!group || (group.ownerId !== user.id && !hasRole(user, 'admin'))) {
    return { ok: false, reason: 'not_found' };
  }

  await db
    .update(schema.groups)
    .set({ deletedAt: new Date() })
    .where(eq(schema.groups.id, groupId));

  return { ok: true, value: undefined };
}

export async function addGroupMember(
  user: SessionUser,
  groupId: string,
  memberId: string,
): Promise<GroupResult> {
  if (!uuidish.test(groupId) || !uuidish.test(memberId)) {
    return { ok: false, reason: 'not_found' };
  }

  const outcome = await db.transaction(async (tx) => {
    const allowed = await canManage(tx, user, groupId);
    if (!allowed) return { ok: false as const, reason: 'not_found' as const };

    // The new member must be an active member of the same batch — a group cannot be
    // used to reach across batches.
    const [target] = await tx
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(
        and(
          eq(schema.users.id, memberId),
          eq(schema.users.batchId, user.batchId),
          eq(schema.users.status, 'active'),
        ),
      )
      .limit(1);

    if (!target) return { ok: false as const, reason: 'invalid_member' as const };

    await tx
      .insert(schema.groupMembers)
      .values({ groupId, userId: memberId, addedBy: user.id })
      .onConflictDoNothing();

    return { ok: true as const };
  });

  if (!outcome.ok) return outcome;

  // Membership changes alter who can reach photos, so they are audited like any
  // other access change.
  await audit({
    action: AuditAction.GROUP_MEMBER_ADDED,
    actorId: user.id,
    actorEmail: user.email,
    targetType: 'group',
    targetId: groupId,
    metadata: { memberId },
  });

  return { ok: true, value: undefined };
}

export async function removeGroupMember(
  user: SessionUser,
  groupId: string,
  memberId: string,
): Promise<GroupResult> {
  if (!uuidish.test(groupId) || !uuidish.test(memberId)) {
    return { ok: false, reason: 'not_found' };
  }

  const allowed = await canManage(db, user, groupId);
  if (!allowed) return { ok: false, reason: 'not_found' };

  await db
    .delete(schema.groupMembers)
    .where(
      and(eq(schema.groupMembers.groupId, groupId), eq(schema.groupMembers.userId, memberId)),
    );

  await audit({
    action: AuditAction.GROUP_MEMBER_REMOVED,
    actorId: user.id,
    actorEmail: user.email,
    targetType: 'group',
    targetId: groupId,
    metadata: { memberId },
  });

  return { ok: true, value: undefined };
}
