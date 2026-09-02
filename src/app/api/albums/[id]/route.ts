import { z } from 'zod';
import { failureStatus, json, requireApiUser } from '@/lib/api';
import { deleteAlbum, getAlbumPhotos, updateAlbum } from '@/lib/albums';

export const runtime = 'nodejs';

export async function GET(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;

  const result = await getAlbumPhotos(auth.user, (await params).id);
  if (!result.ok) return json({ error: 'Not found.' }, { status: failureStatus(result.reason) });

  // `photos` holds only what this viewer may see, so two members legitimately get
  // different counts for the same album.
  return json(result.value);
}

const patchSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  description: z.string().max(1000).nullable().optional(),
  visibility: z.enum(['batch', 'private']).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser({ mutating: true });
  if (auth.error) return auth.error;

  const body = patchSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return json({ error: 'Invalid request.' }, { status: 400 });

  const result = await updateAlbum(auth.user, (await params).id, body.data);
  if (!result.ok) return json({ error: 'Not found.' }, { status: failureStatus(result.reason) });

  return json({ ok: true });
}

export async function DELETE(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser({ mutating: true });
  if (auth.error) return auth.error;

  const result = await deleteAlbum(auth.user, (await params).id);
  if (!result.ok) return json({ error: 'Not found.' }, { status: failureStatus(result.reason) });

  return json({ ok: true });
}
