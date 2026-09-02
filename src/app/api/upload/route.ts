import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { assertSameOrigin, getApiUser } from '@/lib/auth';
import { RateLimits, consumeRateLimit } from '@/lib/rate-limit';
import { REJECTION_MESSAGES, ingestUpload } from '@/lib/photos';

/** Uploads carry binary bodies and native modules; they cannot run on the Edge. */
export const runtime = 'nodejs';

const VISIBILITIES = ['batch', 'group', 'selected', 'private'] as const;
type Visibility = (typeof VISIBILITIES)[number];

/**
 * Accept one photo per request.
 *
 * One file per request rather than a batched multipart body, so that a bulk upload
 * of several hundred photos retries only what actually failed, and reports progress
 * meaningfully. The client drives concurrency.
 */
export async function POST(request: Request) {
  // Layered with SameSite=Lax on the session cookie; this covers non-browser clients
  // and any browser whose cookie policy behaves differently than expected.
  if (!(await assertSameOrigin())) {
    return NextResponse.json({ error: 'Cross-origin request refused.' }, { status: 403 });
  }

  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const limit = await consumeRateLimit(`upload:user:${user.id}`, RateLimits.UPLOAD_PER_USER);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Upload rate limit reached. Try again shortly.' },
      { status: 429, headers: { 'retry-after': String(limit.retryAfterSeconds) } },
    );
  }

  // Reject an oversized body from its declared length before reading it, so a
  // multi-gigabyte upload is refused at the header rather than buffered first.
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > env.MAX_UPLOAD_BYTES * 1.1) {
    return NextResponse.json({ error: REJECTION_MESSAGES.too_large }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Malformed upload.' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file supplied.' }, { status: 400 });
  }

  // Content-Length can lie; this is the real size.
  if (file.size > env.MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: REJECTION_MESSAGES.too_large }, { status: 413 });
  }

  const requested = form.get('visibility');
  const visibility: Visibility =
    typeof requested === 'string' && (VISIBILITIES as readonly string[]).includes(requested)
      ? (requested as Visibility)
      : 'private'; // an unrecognised value falls back to the most restrictive

  const uploadBatchId = form.get('uploadBatchId');

  const bytes = Buffer.from(await file.arrayBuffer());

  const result = await ingestUpload(user, {
    // Kept only as metadata for display and search; storage keys are never derived
    // from it, which is what makes path traversal structurally impossible.
    filename: file.name,
    bytes,
    visibility,
    uploadBatchId: typeof uploadBatchId === 'string' && uploadBatchId ? uploadBatchId : null,
  });

  if (!result.ok) {
    // 507 Insufficient Storage says exactly what happened, and is distinct from the
    // 415 that means "this file is not an image we accept".
    if (result.reason === 'quota_exceeded') {
      return NextResponse.json({ error: result.message }, { status: 507 });
    }
    return NextResponse.json({ error: REJECTION_MESSAGES[result.reason] }, { status: 415 });
  }

  return NextResponse.json(
    {
      photoId: result.photoId,
      duplicate: Boolean(result.duplicateOf),
      status: result.duplicateOf ? 'existing' : 'processing',
    },
    { status: 201 },
  );
}
