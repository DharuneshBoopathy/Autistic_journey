import { z } from 'zod';
import { failureStatus, json, requireApiUser } from '@/lib/api';
import { addGroupMember, removeGroupMember } from '@/lib/groups';

export const runtime = 'nodejs';

const schema = z.object({ userId: z.string().regex(/^[0-9a-f-]{36}$/i) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser({ mutating: true });
  if (auth.error) return auth.error;

  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return json({ error: 'Invalid request.' }, { status: 400 });

  const result = await addGroupMember(auth.user, (await params).id, body.data.userId);
  if (!result.ok) {
    return json(
      {
        error:
          result.reason === 'invalid_member'
            ? 'That person is not an active member of this batch.'
            : 'Not found.',
      },
      { status: failureStatus(result.reason) },
    );
  }

  return json({ ok: true });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser({ mutating: true });
  if (auth.error) return auth.error;

  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return json({ error: 'Invalid request.' }, { status: 400 });

  const result = await removeGroupMember(auth.user, (await params).id, body.data.userId);
  if (!result.ok) return json({ error: 'Not found.' }, { status: failureStatus(result.reason) });

  return json({ ok: true });
}
