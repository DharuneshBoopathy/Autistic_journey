import { z } from 'zod';
import { failureStatus, json, requireApiUser } from '@/lib/api';
import { createEvent, listEvents } from '@/lib/taxonomy';

export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;
  return json({ events: await listEvents(auth.user) });
}

const createSchema = z.object({
  name: z.string().min(1).max(160),
  academicYear: z.string().max(40).nullable().optional(),
  startsOn: z.coerce.date().nullable().optional(),
  endsOn: z.coerce.date().nullable().optional(),
});

export async function POST(request: Request) {
  const auth = await requireApiUser({ mutating: true });
  if (auth.error) return auth.error;

  const body = createSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return json({ error: 'Invalid request.' }, { status: 400 });

  const result = await createEvent(auth.user, body.data);
  if (!result.ok) return json({ error: 'Could not create event.' }, { status: failureStatus(result.reason) });

  return json({ id: result.value.id }, { status: 201 });
}
