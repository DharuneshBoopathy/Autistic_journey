import { failureStatus, json, requireApiUser } from '@/lib/api';
import { getStats } from '@/lib/admin';

export const runtime = 'nodejs';

/** Storage headroom, photo and member counts, and queue depth. */
export async function GET() {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;

  const result = await getStats(auth.user);
  if (!result.ok) return json({ error: 'Not found.' }, { status: failureStatus(result.reason) });

  return json(result.value);
}
