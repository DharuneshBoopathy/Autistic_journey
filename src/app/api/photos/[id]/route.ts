import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, getApiUser } from '@/lib/auth';
import { getPhoto } from '@/lib/gallery';
import {
  restorePhoto,
  setVisibility,
  softDeletePhoto,
  updateMetadata,
  type WriteFailure,
} from '@/lib/photo-mutations';

export const runtime = 'nodejs';

/**
 * Mutations on a single photo.
 *
 * Authorization is not decided here — every handler delegates to
 * `src/lib/photo-mutations.ts`, which re-reads the row's `uploader_id` and applies
 * the uploader-or-admin rule from the database rather than from anything the request
 * carried. This route's only jobs are shape validation and mapping failures to
 * status codes.
 */

const uuid = z.string().regex(/^[0-9a-f-]{36}$/i, 'not a valid id');

const patchSchema = z.object({
  visibility: z.enum(['batch', 'group', 'selected', 'private']).optional(),
  principalIds: z.array(uuid).max(200).optional(),
  caption: z.string().max(2000).nullable().optional(),
  academicYear: z.string().max(40).nullable().optional(),
  semester: z.string().max(40).nullable().optional(),
  eventId: uuid.nullable().optional(),
  locationText: z.string().max(200).nullable().optional(),
  campusZone: z.enum(['campus', 'hostel', 'off_campus', 'unknown']).optional(),
});

/**
 * `not_found` covers both "no such photo" and "not yours".
 *
 * A 403 would confirm the id names a real photo, which is the enumeration leak the
 * whole visibility model exists to prevent — so the two are indistinguishable here,
 * exactly as they are on the read path.
 */
const STATUS: Record<WriteFailure, number> = {
  not_found: 404,
  forbidden: 404,
  invalid_principal: 422,
  not_deleted: 409,
  purge_window_passed: 410,
};

const MESSAGE: Record<WriteFailure, string> = {
  not_found: 'Not found.',
  forbidden: 'Not found.',
  invalid_principal: 'One of the people or groups you selected is not in this batch.',
  not_deleted: 'That photo is not deleted.',
  purge_window_passed: 'That photo was permanently deleted and cannot be restored.',
};

function fail(reason: WriteFailure) {
  return NextResponse.json({ error: MESSAGE[reason] }, { status: STATUS[reason] });
}

async function authorize() {
  if (!(await assertSameOrigin())) {
    return { error: NextResponse.json({ error: 'Cross-origin request refused.' }, { status: 403 }) };
  }
  const user = await getApiUser();
  if (!user) {
    return { error: NextResponse.json({ error: 'Not signed in.' }, { status: 401 }) };
  }
  return { user };
}

/**
 * Full metadata for one photo, for the viewer's detail panel.
 *
 * Reads through `getPhoto`, which selects from `visible_photos` — so a photo the
 * caller may not see is indistinguishable from one that does not exist.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const photo = await getPhoto(user, (await params).id);
  if (!photo) return fail('not_found');

  // The uploader (or an admin) may edit; everyone else gets a read-only panel.
  const canEdit = photo.isMine || user.role === 'admin';

  /*
   * Admins are the only accounts that may fetch an original directly, and the only
   * ones that may hand a member a one-off grant to do so. Both are re-checked where
   * they matter — the variant route and the grants route — so this flag decides what
   * the panel offers, never what the server permits.
   */
  const isAdmin = user.role === 'admin';

  return NextResponse.json(
    { photo, canEdit, isAdmin },
    { headers: { 'cache-control': 'private, no-store' } },
  );
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize();
  if (auth.error) return auth.error;

  const { id } = await params;
  const body = patchSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const { visibility, principalIds, ...metadata } = body.data;

  /*
   * Visibility is applied before metadata, deliberately.
   *
   * If the caller is both narrowing access and editing a caption, the narrowing is
   * the security-relevant half — so it lands first, and a later failure cannot leave
   * the photo more widely visible than intended.
   */
  if (visibility) {
    const result = await setVisibility(auth.user, id, { visibility, principalIds });
    if (!result.ok) return fail(result.reason);
  }

  if (Object.keys(metadata).length > 0) {
    const result = await updateMetadata(auth.user, id, metadata);
    if (!result.ok) return fail(result.reason);
  }

  return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'private, no-store' } });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize();
  if (auth.error) return auth.error;

  const { id } = await params;
  const result = await softDeletePhoto(auth.user, id);
  if (!result.ok) return fail(result.reason);

  return NextResponse.json(
    { ok: true, recoverableUntil: result.value.purgeAfter.toISOString() },
    { headers: { 'cache-control': 'private, no-store' } },
  );
}

const postSchema = z.object({ action: z.literal('restore') });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize();
  if (auth.error) return auth.error;

  const body = postSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });

  const { id } = await params;
  const result = await restorePhoto(auth.user, id);
  if (!result.ok) return fail(result.reason);

  return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'private, no-store' } });
}
