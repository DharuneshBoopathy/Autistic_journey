import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { withViewer } from '@/db';
import { AuditAction, audit } from '@/lib/audit';
import { getApiUser, hasRole } from '@/lib/auth';
import { consumeDownloadGrant } from '@/lib/download-grants';
import { storageByName } from '@/lib/storage';

export const runtime = 'nodejs';

const VARIANTS = ['thumb', 'preview', 'original'] as const;
type Variant = (typeof VARIANTS)[number];

/**
 * Serve photo bytes.
 *
 * This is the only route that emits image data, and it re-checks authorization on
 * every single request. There is deliberately no signed-URL scheme and no public
 * bucket: a URL that grants access on its own is a credential that can be pasted
 * into a group chat, and it keeps working after the photo's visibility is narrowed.
 * Here, revoking access takes effect on the very next request.
 *
 * The cost is that bytes pass through the app rather than a CDN. For a single
 * batch's archive that is the right trade — correctness over a saved hop — and it is
 * why derivatives are kept small.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; variant: string }> },
) {
  const { id, variant: rawVariant } = await params;

  if (!(VARIANTS as readonly string[]).includes(rawVariant)) {
    return NextResponse.json({ error: 'Unknown variant.' }, { status: 404 });
  }
  const variant = rawVariant as Variant;

  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  // A malformed id is "not found", not a validation error — the response must not
  // distinguish "no such photo" from "not yours". See the 404 below.
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return notFound();
  }

  /*
   * The authorization check and the metadata read are one query against
   * `visible_photos`, so there is no window between deciding and fetching, and no
   * way to serve bytes for a row the predicate excluded.
   */
  const row = await withViewer({ id: user.id, batchId: user.batchId }, async (tx) => {
    const result = await tx.execute<{
      storage_key: string;
      driver: string;
      mime: string;
      filename: string | null;
      download_allowed: boolean;
    }>(sql`
      SELECT
        CASE WHEN ${variant} = 'original' THEN p.original_key    ELSE d.storage_key END AS storage_key,
        CASE WHEN ${variant} = 'original' THEN p.original_driver ELSE d.driver      END AS driver,
        CASE WHEN ${variant} = 'original' THEN p.mime            ELSE 'image/webp'  END AS mime,
        p.original_filename AS filename,
        p.download_allowed
      FROM visible_photos p
      LEFT JOIN photo_derivatives d
        ON d.photo_id = p.id
       AND d.kind = (CASE WHEN ${variant} = 'thumb' THEN 'thumb' ELSE 'preview' END)::derivative_kind
      WHERE p.id = ${id}::uuid
      LIMIT 1
    `);
    return Array.from(result)[0] ?? null;
  });

  if (!row?.storage_key || !row.driver) {
    return notFound();
  }

  /*
   * View is not download.
   *
   * Members receive derivatives only. Originals need either the admin role, or a
   * single-use grant an admin issued to this member for this photo — the documented,
   * expiring exception. Every release is recorded either way, so "who took a
   * full-resolution copy of what, and when" stays answerable.
   *
   * The grant is consumed here rather than merely checked: consuming it is the point,
   * and doing so before streaming means a failed transfer costs the grant. That is
   * the safer direction — re-issuing one is a message to an admin, whereas a grant
   * that survives its use is not single-use at all.
   */
  let viaGrant = false;
  if (variant === 'original' && !hasRole(user, 'admin')) {
    viaGrant = await consumeDownloadGrant(user, id);
    if (!viaGrant) return notFound();
  }

  let body: ReadableStream<Uint8Array>;
  try {
    body = await storageByName(row.driver).getStream(row.storage_key);
  } catch {
    // The row exists but its object does not — a processing or storage fault, not an
    // authorization one.
    return NextResponse.json({ error: 'That image is unavailable.' }, { status: 502 });
  }

  if (variant === 'original') {
    await audit({
      action: AuditAction.ORIGINAL_DOWNLOADED,
      actorId: user.id,
      actorEmail: user.email,
      targetType: 'photo',
      targetId: id,
      metadata: { via: viaGrant ? 'download_grant' : 'admin_role' },
    });
  }

  return new NextResponse(body, {
    headers: {
      'content-type': row.mime,
      /*
       * `private` keeps these out of any shared cache — a CDN or corporate proxy
       * caching one member's authorized response and replaying it to another would
       * defeat the whole predicate. `no-store` means the check runs every time.
       *
       * This deliberately inverts the reference portfolio's rule, which cached
       * images for a year in a shared cache: correct for a public site, disastrous
       * here.
       */
      'cache-control': 'private, no-store, max-age=0, must-revalidate',
      /*
       * Originals download rather than render. Combined with `nosniff` (set globally)
       * this means a polyglot original can never be interpreted as a document in the
       * browser, even though its bytes are preserved untouched.
       */
      'content-disposition':
        variant === 'original'
          ? `attachment; filename="${sanitizeFilename(row.filename ?? `${id}.bin`)}"`
          : 'inline',
      'x-content-type-options': 'nosniff',
    },
  });
}

/**
 * One response for "no such photo" and for "not permitted".
 *
 * A 403 would confirm the photo exists, which turns this route into an oracle for
 * enumerating the archive — exactly the leak the visibility model exists to prevent.
 */
function notFound() {
  return NextResponse.json({ error: 'Not found.' }, { status: 404 });
}

/**
 * Filenames come from uploaders and are echoed into a response header, so anything
 * that could terminate or extend that header has to go. A name containing CR/LF
 * would otherwise let an uploader inject headers of their own choosing.
 *
 * A conservative allowlist is safer than trying to enumerate what is dangerous:
 * letters, digits, dot, dash, underscore and space survive; everything else does not.
 */
function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[^A-Za-z0-9._ -]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  return cleaned || 'download';
}
