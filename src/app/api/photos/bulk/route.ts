import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, getApiUser } from '@/lib/auth';
import { RateLimits, consumeRateLimit } from '@/lib/rate-limit';
import {
  MAX_BULK_IDS,
  bulkApply,
  setVisibility,
  softDeletePhoto,
  updateMetadata,
} from '@/lib/photo-mutations';

export const runtime = 'nodejs';

const uuid = z.string().regex(/^[0-9a-f-]{36}$/i);

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('setVisibility'),
    photoIds: z.array(uuid).min(1).max(MAX_BULK_IDS),
    visibility: z.enum(['batch', 'group', 'selected', 'private']),
    principalIds: z.array(uuid).max(200).optional(),
  }),
  z.object({
    action: z.literal('delete'),
    photoIds: z.array(uuid).min(1).max(MAX_BULK_IDS),
  }),
  z.object({
    action: z.literal('setMetadata'),
    photoIds: z.array(uuid).min(1).max(MAX_BULK_IDS),
    academicYear: z.string().max(40).nullable().optional(),
    semester: z.string().max(40).nullable().optional(),
    eventId: uuid.nullable().optional(),
    locationText: z.string().max(200).nullable().optional(),
    campusZone: z.enum(['campus', 'hostel', 'off_campus', 'unknown']).optional(),
  }),
]);

/**
 * Apply one operation to many photos.
 *
 * Every id is authorized individually inside `bulkApply` — selecting a photo in the
 * UI grants nothing, and a batch is not a way to act on a photo the caller could not
 * act on one at a time. The response reports per-id outcomes so a partial success is
 * visible rather than silently swallowed.
 *
 * Note there is no bulk *restore*: restoring is rare, and a bulk undelete is the kind
 * of operation where an over-broad selection quietly resurrects photos someone
 * intended to remove. It stays deliberate and per-photo.
 */
export async function POST(request: Request) {
  if (!(await assertSameOrigin())) {
    return NextResponse.json({ error: 'Cross-origin request refused.' }, { status: 403 });
  }

  const user = await getApiUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  // A bulk call is many writes; rate-limit it as such.
  const limit = await consumeRateLimit(`bulk:user:${user.id}`, RateLimits.UPLOAD_PER_USER);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests.' },
      { status: 429, headers: { 'retry-after': String(limit.retryAfterSeconds) } },
    );
  }

  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { error: `Invalid request. At most ${MAX_BULK_IDS} photos per call.` },
      { status: 400 },
    );
  }

  const input = body.data;

  const outcomes = await bulkApply(user, input.photoIds, async (photoId) => {
    switch (input.action) {
      case 'setVisibility':
        return setVisibility(user, photoId, {
          visibility: input.visibility,
          principalIds: input.principalIds,
        });
      case 'delete':
        return softDeletePhoto(user, photoId);
      case 'setMetadata': {
        const { action: _action, photoIds: _photoIds, ...patch } = input;
        return updateMetadata(user, photoId, patch);
      }
    }
  });

  const succeeded = outcomes.filter((o) => o.ok).length;

  return NextResponse.json(
    { succeeded, failed: outcomes.length - succeeded, outcomes },
    { headers: { 'cache-control': 'private, no-store' } },
  );
}
