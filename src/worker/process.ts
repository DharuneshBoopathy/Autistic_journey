/**
 * Derivative-generation: the work itself, separated from the process that loops.
 *
 * Claims jobs from `processing_jobs` and renders each photo's thumbnail and preview.
 * `src/worker/index.ts` is the long-running process; this module holds the logic so
 * that tests can drain the queue directly instead of racing a background daemon.
 *
 * Jobs are claimed with `FOR UPDATE SKIP LOCKED`, which lets several workers run
 * concurrently without any of them handling the same photo — the standard Postgres
 * queue pattern, and the reason this needs no separate queue service.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { generateDerivatives } from '@/lib/images';
import { buildKey, derivativeStorage, storageByName } from '@/lib/storage';

const WORKER_ID = `${process.pid}-${randomUUID().slice(0, 8)}`;
const BATCH_SIZE = 4;

type Claimed = { job_id: string; photo_id: string; attempts: number };

/**
 * Atomically take up to `BATCH_SIZE` due jobs.
 *
 * The CTE selects candidates with SKIP LOCKED and the UPDATE marks them running in
 * the same statement, so two workers polling simultaneously cannot both claim a job.
 */
export async function claim(): Promise<Claimed[]> {
  const rows = await db.execute<Claimed>(sql`
    WITH due AS (
      SELECT id
      FROM processing_jobs
      WHERE state = 'queued' AND run_after <= now()
      ORDER BY run_after
      FOR UPDATE SKIP LOCKED
      LIMIT ${BATCH_SIZE}
    )
    UPDATE processing_jobs j
       SET state = 'running',
           attempts = j.attempts + 1,
           locked_at = now(),
           locked_by = ${WORKER_ID},
           updated_at = now()
      FROM due
     WHERE j.id = due.id
    RETURNING j.id AS job_id, j.photo_id, j.attempts
  `);

  return Array.from(rows);
}

export async function renderDerivatives(photoId: string): Promise<void> {
  const [photo] = await db
    .select({
      id: schema.photos.id,
      originalKey: schema.photos.originalKey,
      originalDriver: schema.photos.originalDriver,
    })
    .from(schema.photos)
    .where(eq(schema.photos.id, photoId))
    .limit(1);

  if (!photo?.originalKey || !photo.originalDriver) {
    throw new Error(`Photo ${photoId} has no stored original`);
  }

  const source = storageByName(photo.originalDriver);
  const original = await source.get(photo.originalKey);

  const { thumb, preview } = await generateDerivatives(original);
  const target = derivativeStorage();

  const [storedThumb, storedPreview] = await Promise.all([
    target.put(buildKey('thumb', photoId, 'webp'), thumb.buffer, { contentType: 'image/webp' }),
    target.put(buildKey('preview', photoId, 'webp'), preview.buffer, { contentType: 'image/webp' }),
  ]);

  await db.transaction(async (tx) => {
    // Re-running a job (after a retry, or a deliberate regeneration) must replace
    // the previous derivatives rather than collide with the unique (photo, kind).
    await tx.delete(schema.photoDerivatives).where(eq(schema.photoDerivatives.photoId, photoId));

    await tx.insert(schema.photoDerivatives).values([
      {
        photoId,
        kind: 'thumb',
        storageKey: storedThumb.key,
        driver: target.name,
        width: thumb.width,
        height: thumb.height,
        bytes: thumb.bytes,
      },
      {
        photoId,
        kind: 'preview',
        storageKey: storedPreview.key,
        driver: target.name,
        width: preview.width,
        height: preview.height,
        bytes: preview.bytes,
      },
    ]);

    // Only now does the photo become visible in the gallery: `visible_photos`
    // requires status = 'ready', so nothing appears before it can be rendered.
    await tx
      .update(schema.photos)
      .set({ status: 'ready', processingError: null, updatedAt: new Date() })
      .where(eq(schema.photos.id, photoId));
  });
}

export async function runOnce(): Promise<number> {
  const jobs = await claim();

  for (const job of jobs) {
    try {
      await renderDerivatives(job.photo_id);

      await db
        .update(schema.processingJobs)
        .set({ state: 'succeeded', lastError: null, updatedAt: new Date() })
        .where(eq(schema.processingJobs.id, job.job_id));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      const [row] = await db
        .select({ maxAttempts: schema.processingJobs.maxAttempts })
        .from(schema.processingJobs)
        .where(eq(schema.processingJobs.id, job.job_id))
        .limit(1);

      const exhausted = job.attempts >= (row?.maxAttempts ?? 5);

      // Exponential backoff, so a transient storage outage is not hammered.
      const backoffSeconds = Math.min(3600, 2 ** job.attempts * 15);

      await db
        .update(schema.processingJobs)
        .set({
          state: exhausted ? 'failed' : 'queued',
          lastError: message.slice(0, 2000),
          runAfter: new Date(Date.now() + backoffSeconds * 1000),
          updatedAt: new Date(),
        })
        .where(eq(schema.processingJobs.id, job.job_id));

      if (exhausted) {
        // Surfaced in the admin dashboard rather than lost to a log file.
        await db
          .update(schema.photos)
          .set({ status: 'failed', processingError: message.slice(0, 2000), updatedAt: new Date() })
          .where(eq(schema.photos.id, job.photo_id));
      }

      console.error(`[worker] job ${job.job_id} failed (attempt ${job.attempts}):`, message);
    }
  }

  return jobs.length;
}

/** Re-queue jobs whose worker died mid-flight and left them 'running'. */
export async function requeueStalled(): Promise<void> {
  await db.execute(sql`
    UPDATE processing_jobs
       SET state = 'queued', locked_at = NULL, locked_by = NULL, updated_at = now()
     WHERE state = 'running' AND locked_at < now() - interval '15 minutes'
  `);
}


/**
 * Run the queue to completion. Used by tests and by one-off backfills; the
 * long-running worker uses `runOnce` on a loop instead.
 */
export async function drainQueue(maxPasses = 50): Promise<number> {
  let total = 0;
  for (let pass = 0; pass < maxPasses; pass++) {
    const processed = await runOnce();
    if (processed === 0) return total;
    total += processed;
  }
  return total;
}
