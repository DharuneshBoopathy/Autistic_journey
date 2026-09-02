import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { env } from '@/lib/env';

/**
 * Storage accounting and the soft quota.
 *
 * The archive is expected to run on a free storage tier during development, and free
 * tiers do not degrade gracefully: once exhausted, writes fail with an error that
 * looks like a transient fault, and the obvious response — retry — makes it worse.
 * So usage is tracked and uploads are refused *before* the ceiling, with a message
 * that says what happened.
 *
 * This is a soft limit by design. It stops new uploads; it never blocks reads,
 * deletions, or anything else a member needs in order to free space.
 */

export type StorageUsage = {
  originalBytes: number;
  derivativeBytes: number;
  totalBytes: number;
  quotaBytes: number;
  /** 0–1. Above 1 means the ceiling has been passed. */
  fraction: number;
  remainingBytes: number;
  photoCount: number;
};

/**
 * Cached briefly.
 *
 * The query aggregates two whole tables, which is cheap at 10k photos and not free
 * at 100k. Uploads consult it on every request, so a short cache keeps a bulk upload
 * of several hundred photos from re-summing the archive several hundred times. The
 * staleness that buys is bounded by the window and costs at most a few megabytes of
 * overshoot against a ceiling already set below the real limit.
 */
const CACHE_MS = 30_000;
let cached: { at: number; value: StorageUsage } | null = null;

export async function getStorageUsage(options: { fresh?: boolean } = {}): Promise<StorageUsage> {
  if (!options.fresh && cached && Date.now() - cached.at < CACHE_MS) {
    return cached.value;
  }

  const rows = await db.execute<{
    original_bytes: string | null;
    derivative_bytes: string | null;
    photo_count: string;
  }>(sql`
    SELECT
      (SELECT coalesce(sum(original_bytes), 0) FROM photos)            AS original_bytes,
      (SELECT coalesce(sum(bytes), 0) FROM photo_derivatives)          AS derivative_bytes,
      (SELECT count(*) FROM photos)                                    AS photo_count
  `);

  const row = Array.from(rows)[0];
  const originalBytes = Number(row?.original_bytes ?? 0);
  const derivativeBytes = Number(row?.derivative_bytes ?? 0);
  const totalBytes = originalBytes + derivativeBytes;
  const quotaBytes = env.STORAGE_SOFT_QUOTA_BYTES;

  // Soft-deleted photos still occupy storage until the purge sweep collects them,
  // so they are counted. Reporting otherwise would understate what is actually
  // billed and let the real ceiling arrive unannounced.
  const value: StorageUsage = {
    originalBytes,
    derivativeBytes,
    totalBytes,
    quotaBytes,
    fraction: quotaBytes > 0 ? totalBytes / quotaBytes : 0,
    remainingBytes: Math.max(0, quotaBytes - totalBytes),
    photoCount: Number(row?.photo_count ?? 0),
  };

  cached = { at: Date.now(), value };
  return value;
}

/** Drop the cache after a write that materially changes usage, such as a purge. */
export function invalidateStorageUsage(): void {
  cached = null;
}

export type QuotaCheck =
  | { allowed: true; usage: StorageUsage }
  | { allowed: false; usage: StorageUsage; message: string };

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${Math.round(bytes / 1_048_576)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

/**
 * May an upload of `incomingBytes` proceed?
 *
 * Fails **open** on a database error, matching the rate limiter: a transient fault
 * in accounting should not stop people using the archive, and the storage provider
 * enforces the real limit regardless.
 */
export async function checkQuota(incomingBytes: number): Promise<QuotaCheck> {
  let usage: StorageUsage;
  try {
    usage = await getStorageUsage();
  } catch (error) {
    console.error('[quota] usage lookup failed, allowing upload', error);
    const quotaBytes = env.STORAGE_SOFT_QUOTA_BYTES;
    return {
      allowed: true,
      usage: {
        originalBytes: 0,
        derivativeBytes: 0,
        totalBytes: 0,
        quotaBytes,
        fraction: 0,
        remainingBytes: quotaBytes,
        photoCount: 0,
      },
    };
  }

  if (usage.totalBytes + incomingBytes <= usage.quotaBytes) {
    return { allowed: true, usage };
  }

  /*
   * About to refuse — so re-read before doing so.
   *
   * The cache may be holding a figure from before a purge or a deletion freed space,
   * and a stale *refusal* keeps the archive closed for up to the cache window after
   * the problem was fixed. Being briefly wrong in the permissive direction costs a
   * few megabytes against a ceiling deliberately set below the real one; being wrong
   * in the blocking direction costs everyone the ability to upload.
   */
  const fresh = await getStorageUsage({ fresh: true });
  if (fresh.totalBytes + incomingBytes <= fresh.quotaBytes) {
    return { allowed: true, usage: fresh };
  }
  usage = fresh;

  return {
    allowed: false,
    usage,
    message:
      `The archive has reached its storage limit ` +
      `(${formatBytes(usage.totalBytes)} of ${formatBytes(usage.quotaBytes)}). ` +
      'An administrator needs to free space or increase the limit before more photos can be added.',
  };
}
