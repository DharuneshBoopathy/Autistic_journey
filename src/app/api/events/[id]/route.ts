import { failureStatus, json, requireApiUser } from '@/lib/api';
import { deleteEvent } from '@/lib/taxonomy';

export const runtime = 'nodejs';

export async function DELETE(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser({ mutating: true });
  if (auth.error) return auth.error;

  const result = await deleteEvent(auth.user, (await params).id);
  if (!result.ok) return json({ error: 'Not found.' }, { status: failureStatus(result.reason) });

  return json({ ok: true });
}
