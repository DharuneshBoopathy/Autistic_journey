import { z } from 'zod';
import { failureStatus, json, requireApiUser } from '@/lib/api';
import { createGroup, listGroups } from '@/lib/groups';

export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;
  return json({ groups: await listGroups(auth.user) });
}

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).nullable().optional(),
});

export async function POST(request: Request) {
  const auth = await requireApiUser({ mutating: true });
  if (auth.error) return auth.error;

  const body = createSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return json({ error: 'Invalid request.' }, { status: 400 });

  const result = await createGroup(auth.user, body.data);
  if (!result.ok) return json({ error: 'Could not create group.' }, { status: failureStatus(result.reason) });

  return json({ id: result.value.id }, { status: 201 });
}
