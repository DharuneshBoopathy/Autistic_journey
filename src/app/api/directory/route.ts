import { and, asc, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { json, requireApiUser } from '@/lib/api';
import { listGroups } from '@/lib/groups';

export const runtime = 'nodejs';

/**
 * Who a photo can be shared with: the active members of the caller's own batch, and
 * the groups in it.
 *
 * Members of the same batch are not a secret from each other — sharing a photo with
 * a named person requires being able to name them. What this does *not* expose is
 * anything about what those people have uploaded or can see; it is a list of names
 * and nothing more.
 */
export async function GET() {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;

  const [people, groups] = await Promise.all([
    db
      .select({ id: schema.users.id, displayName: schema.users.displayName })
      .from(schema.users)
      .where(
        and(
          eq(schema.users.batchId, auth.user.batchId),
          eq(schema.users.status, 'active'),
        ),
      )
      .orderBy(asc(schema.users.displayName)),
    listGroups(auth.user),
  ]);

  return json({
    people: people.filter((p) => p.id !== auth.user.id),
    groups: groups.map((g) => ({ id: g.id, name: g.name, memberCount: g.memberCount })),
  });
}
