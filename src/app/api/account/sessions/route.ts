import { z } from 'zod';
import { json, requireApiUser } from '@/lib/api';
import { listSessions, revokeOtherSessions, revokeSession } from '@/lib/account';

export const runtime = 'nodejs';

/**
 * The caller's own sessions.
 *
 * There is no user id anywhere in this route, by design. Everything is scoped to
 * the session making the request, so there is no parameter to tamper with in order
 * to read or end somebody else's sessions.
 */
export async function GET() {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;

  return json(await listSessions(auth.user));
}

const schema = z.union([
  z.object({ sessionId: z.string().regex(/^[0-9a-f-]{36}$/i) }),
  z.object({ scope: z.literal('others') }),
]);

export async function DELETE(request: Request) {
  const auth = await requireApiUser({ mutating: true });
  if (auth.error) return auth.error;

  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return json({ error: 'Invalid request.' }, { status: 400 });

  if ('scope' in body.data) {
    return json({ revoked: await revokeOtherSessions(auth.user) });
  }

  const result = await revokeSession(auth.user, body.data.sessionId);
  if (!result.ok) return json({ error: 'Not found.' }, { status: 404 });

  return json({ revoked: result.revoked });
}
