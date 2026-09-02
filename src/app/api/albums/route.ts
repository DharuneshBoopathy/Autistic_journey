import { z } from 'zod';
import { failureStatus, json, requireApiUser } from '@/lib/api';
import { createAlbum, listAlbums } from '@/lib/albums';

export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;
  return json({ albums: await listAlbums(auth.user) });
}

const createSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(1000).nullable().optional(),
  visibility: z.enum(['batch', 'private']).optional(),
});

export async function POST(request: Request) {
  const auth = await requireApiUser({ mutating: true });
  if (auth.error) return auth.error;

  const body = createSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return json({ error: 'Invalid request.' }, { status: 400 });

  const result = await createAlbum(auth.user, body.data);
  if (!result.ok) return json({ error: 'Could not create album.' }, { status: failureStatus(result.reason) });

  return json({ id: result.value.id }, { status: 201 });
}
