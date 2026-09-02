import { failureStatus, json, requireApiUser } from '@/lib/api';
import { listMembers } from '@/lib/admin';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;

  const status = new URL(request.url).searchParams.get('status') ?? undefined;
  const result = await listMembers(auth.user, { status });
  if (!result.ok) return json({ error: 'Not found.' }, { status: failureStatus(result.reason) });

  return json({ members: result.value });
}
