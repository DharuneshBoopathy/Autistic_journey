import { z } from 'zod';
import { failureStatus, json, requireApiUser } from '@/lib/api';
import { listFailures, retryProcessing } from '@/lib/admin';

export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;

  const result = await listFailures(auth.user);
  if (!result.ok) return json({ error: 'Not found.' }, { status: failureStatus(result.reason) });

  return json({ failures: result.value });
}

const retrySchema = z.object({ photoId: z.string().regex(/^[0-9a-f-]{36}$/i) });

export async function POST(request: Request) {
  const auth = await requireApiUser({ mutating: true });
  if (auth.error) return auth.error;

  const body = retrySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return json({ error: 'Invalid request.' }, { status: 400 });

  const result = await retryProcessing(auth.user, body.data.photoId);
  if (!result.ok) {
    return json(
      {
        error:
          result.reason === 'invalid'
            ? 'That photo has no stored original, so there is nothing to re-derive.'
            : 'Not found.',
      },
      { status: failureStatus(result.reason) },
    );
  }

  return json({ ok: true });
}
