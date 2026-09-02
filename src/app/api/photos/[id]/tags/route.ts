import { z } from 'zod';
import { failureStatus, json, requireApiUser } from '@/lib/api';
import { tagPhoto, untagPhoto } from '@/lib/taxonomy';

export const runtime = 'nodejs';

const schema = z.object({ tags: z.array(z.string().min(1).max(60)).min(1).max(30) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser({ mutating: true });
  if (auth.error) return auth.error;

  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return json({ error: 'Invalid request.' }, { status: 400 });

  const result = await tagPhoto(auth.user, (await params).id, body.data.tags);
  if (!result.ok) return json({ error: 'Not found.' }, { status: failureStatus(result.reason) });

  return json(result.value);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser({ mutating: true });
  if (auth.error) return auth.error;

  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return json({ error: 'Invalid request.' }, { status: 400 });

  const result = await untagPhoto(auth.user, (await params).id, body.data.tags);
  if (!result.ok) return json({ error: 'Not found.' }, { status: failureStatus(result.reason) });

  return json(result.value);
}
