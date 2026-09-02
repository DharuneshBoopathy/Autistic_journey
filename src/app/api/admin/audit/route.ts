import { failureStatus, json, requireApiUser } from '@/lib/api';
import { readAuditLog } from '@/lib/admin';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;

  const params = new URL(request.url).searchParams;
  const before = Number(params.get('before'));

  const result = await readAuditLog(auth.user, {
    action: params.get('action') ?? undefined,
    targetId: params.get('targetId') ?? undefined,
    before: Number.isFinite(before) && before > 0 ? before : undefined,
    limit: Number(params.get('limit')) || undefined,
  });

  if (!result.ok) return json({ error: 'Not found.' }, { status: failureStatus(result.reason) });

  return json({ entries: result.value });
}
