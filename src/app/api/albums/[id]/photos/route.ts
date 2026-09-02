import { z } from 'zod';
import { failureStatus, json, requireApiUser } from '@/lib/api';
import { addPhotosToAlbum, removePhotosFromAlbum } from '@/lib/albums';

export const runtime = 'nodejs';

const schema = z.object({
  photoIds: z.array(z.string().regex(/^[0-9a-f-]{36}$/i)).min(1).max(500),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser({ mutating: true });
  if (auth.error) return auth.error;

  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return json({ error: 'Invalid request.' }, { status: 400 });

  const result = await addPhotosToAlbum(auth.user, (await params).id, body.data.photoIds);
  if (!result.ok) return json({ error: 'Not found.' }, { status: failureStatus(result.reason) });

  // `added` can be lower than the number sent: ids the caller cannot see are
  // silently skipped rather than reported, which would confirm they exist.
  return json(result.value);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser({ mutating: true });
  if (auth.error) return auth.error;

  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return json({ error: 'Invalid request.' }, { status: 400 });

  const result = await removePhotosFromAlbum(auth.user, (await params).id, body.data.photoIds);
  if (!result.ok) return json({ error: 'Not found.' }, { status: failureStatus(result.reason) });

  return json(result.value);
}
