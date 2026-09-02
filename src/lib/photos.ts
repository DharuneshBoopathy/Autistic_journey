import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@/db';
import { env } from '@/lib/env';
import { AuditAction, audit } from '@/lib/audit';
import { validateImage, type ValidationFailure } from '@/lib/images';
import { buildKey, originalStorage } from '@/lib/storage';
import { checkQuota, invalidateStorageUsage } from '@/lib/quota';
import type { SessionUser } from '@/lib/session';

export type IngestResult =
  | { ok: true; photoId: string; duplicateOf?: string }
  | { ok: false; reason: ValidationFailure }
  | { ok: false; reason: 'quota_exceeded'; message: string };

export type IngestInput = {
  filename: string;
  bytes: Buffer;
  uploadBatchId?: string | null;
  /** Defaults to `private`. A photo never becomes batch-visible by omission. */
  visibility?: 'batch' | 'group' | 'selected' | 'private';
};

/**
 * Accept one uploaded file.
 *
 * Order is the security property here — nothing is written anywhere until the bytes
 * have been proven to be a decodable image within limits:
 *
 *   1. validate (magic bytes, size, pixel count, decodability)
 *   2. de-duplicate by content digest
 *   3. store the original
 *   4. create the row
 *   5. enqueue derivative generation
 *
 * Because validation precedes storage, there is no window in which unvalidated
 * bytes sit in the archive, and therefore no need for a separate quarantine bucket
 * to sweep. A file that fails validation is simply never written.
 *
 * The original is stored byte-exact. The brief asks for originals to be preserved
 * *and* for polyglot payloads to be neutralised, which pull in opposite directions —
 * re-encoding an original destroys it. The resolution: keep originals untouched but
 * unreachable (members can never download them; admin downloads are forced to
 * `Content-Disposition: attachment` with `nosniff`), and make the re-encoded
 * derivatives the only bytes ever rendered in a browser. Preservation and safety
 * both hold, because the two live on different paths.
 */
export async function ingestUpload(
  user: SessionUser,
  input: IngestInput,
): Promise<IngestResult> {
  const validated = await validateImage(input.bytes, env.MAX_UPLOAD_BYTES);
  if (!validated.ok) return { ok: false, reason: validated.reason };

  const { image } = validated;

  /*
   * Quota is checked after validation and before storage.
   *
   * After validation, so a malformed file is rejected on its own terms rather than
   * being blamed on a full archive. Before storage, because the whole point is to
   * refuse the write with an explanation instead of letting the provider fail with
   * something that reads like a transient error.
   *
   * Duplicates are checked below and consume no new space, but they are rare enough
   * that ordering the cheap quota check first is not worth the extra branch.
   */
  const quota = await checkQuota(image.bytes);
  if (!quota.allowed) {
    return { ok: false, reason: 'quota_exceeded', message: quota.message };
  }

  // De-duplicate within the batch. Re-uploading the same file — which happens
  // constantly when several people share the same event photos — should not cost
  // storage twice.
  const [existing] = await db
    .select({ id: schema.photos.id })
    .from(schema.photos)
    .where(
      and(
        eq(schema.photos.batchId, user.batchId),
        eq(schema.photos.sha256, image.sha256),
        isNull(schema.photos.deletedAt),
      ),
    )
    .limit(1);

  if (existing) {
    return { ok: true, photoId: existing.id, duplicateOf: existing.id };
  }

  // Create the row first so its id can seed the storage key, keeping keys derived
  // from server-chosen identifiers only.
  const [created] = await db
    .insert(schema.photos)
    .values({
      batchId: user.batchId,
      uploaderId: user.id,
      uploadBatchId: input.uploadBatchId ?? null,
      status: 'uploading',
      visibility: input.visibility ?? 'private',
      originalFilename: input.filename.slice(0, 255),
      mime: image.format.mime,
      width: image.width,
      height: image.height,
      sha256: image.sha256,
      originalBytes: image.bytes,
      takenAt: image.takenAt ?? new Date(),
    })
    .returning({ id: schema.photos.id });

  const photoId = created!.id;
  const storage = originalStorage();
  const key = buildKey('original', photoId, image.format.ext);

  try {
    // `put` returns the canonical key — Drive assigns its own id — so persist what
    // comes back rather than what we asked for.
    const stored = await storage.put(key, input.bytes, { contentType: image.format.mime });

    await db.transaction(async (tx) => {
      await tx
        .update(schema.photos)
        .set({
          originalKey: stored.key,
          originalDriver: storage.name,
          status: 'processing',
          updatedAt: new Date(),
        })
        .where(eq(schema.photos.id, photoId));

      await tx.insert(schema.processingJobs).values({ photoId, kind: 'derivatives' });
    });
  } catch (error) {
    // Leave the row as evidence rather than deleting it: a failed upload should be
    // visible in the admin dashboard, not silently vanish.
    await db
      .update(schema.photos)
      .set({
        status: 'failed',
        processingError: error instanceof Error ? error.message : 'storage write failed',
        updatedAt: new Date(),
      })
      .where(eq(schema.photos.id, photoId));

    throw error;
  }

  // The archive just grew; the next quota check should see it.
  invalidateStorageUsage();

  await audit({
    action: AuditAction.PHOTO_UPLOADED,
    actorId: user.id,
    actorEmail: user.email,
    targetType: 'photo',
    targetId: photoId,
    metadata: {
      bytes: image.bytes,
      mime: image.format.mime,
      visibility: input.visibility ?? 'private',
    },
  });

  return { ok: true, photoId };
}

/** Human-readable reasons, safe to show an uploader. */
export const REJECTION_MESSAGES: Record<ValidationFailure, string> = {
  empty: 'That file is empty.',
  too_large: `That file is larger than the ${Math.round(env.MAX_UPLOAD_BYTES / 1024 / 1024)} MB limit.`,
  unrecognised_format: 'That is not a supported image (JPEG, PNG, WebP, GIF, TIFF or HEIC).',
  dimensions_unreadable: 'That image could not be read.',
  too_many_pixels: 'That image is too large to process.',
  decode_failed: 'That image could not be read — it may be corrupt.',
};
