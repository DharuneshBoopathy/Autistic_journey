import { z } from 'zod';
import { failureStatus, json, requireApiUser } from '@/lib/api';
import { issueDownloadGrant, listGrants } from '@/lib/download-grants';

export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;

  const result = await listGrants(auth.user);
  if (!result.ok) return json({ error: 'Not found.' }, { status: failureStatus(result.reason) });

  return json({ grants: result.value });
}

const schema = z.object({
  photoId: z.string().regex(/^[0-9a-f-]{36}$/i),
  userId: z.string().regex(/^[0-9a-f-]{36}$/i),
  reason: z.string().max(500).optional(),
  expiresInMinutes: z.number().int().min(1).max(10080).optional(),
});

/**
 * Grant one member a single-use, expiring right to download one original.
 *
 * The documented exception to "view is not download" — narrow, time-limited and
 * audited, rather than the alternative of promoting someone to admin because they
 * needed one file.
 */
export async function POST(request: Request) {
  const auth = await requireApiUser({ mutating: true });
  if (auth.error) return auth.error;

  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return json({ error: 'Invalid request.' }, { status: 400 });

  const result = await issueDownloadGrant(auth.user, body.data);
  if (!result.ok) {
    return json(
      {
        error:
          result.reason === 'invalid'
            ? 'That person is not an active member of this batch.'
            : 'Not found.',
      },
      { status: failureStatus(result.reason) },
    );
  }

  return json(
    { id: result.value.id, expiresAt: result.value.expiresAt.toISOString() },
    { status: 201 },
  );
}
