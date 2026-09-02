import { z } from 'zod';
import { failureStatus, json, requireApiUser } from '@/lib/api';
import { deleteGroup, listGroupMembers, renameGroup } from '@/lib/groups';

export const runtime = 'nodejs';

export async function GET(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;

  const result = await listGroupMembers(auth.user, (await params).id);
  if (!result.ok) return json({ error: 'Not found.' }, { status: failureStatus(result.reason) });

  return json({ members: result.value });
}

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(1000).nullable().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser({ mutating: true });
  if (auth.error) return auth.error;

  const body = patchSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return json({ error: 'Invalid request.' }, { status: 400 });

  const result = await renameGroup(auth.user, (await params).id, body.data);
  if (!result.ok) return json({ error: 'Not found.' }, { status: failureStatus(result.reason) });

  return json({ ok: true });
}

export async function DELETE(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser({ mutating: true });
  if (auth.error) return auth.error;

  const result = await deleteGroup(auth.user, (await params).id);
  if (!result.ok) return json({ error: 'Not found.' }, { status: failureStatus(result.reason) });

  return json({ ok: true });
}
