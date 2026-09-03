import { z } from 'zod';

/**
 * Validated environment. Import this instead of touching `process.env` directly —
 * a missing or malformed value fails loudly at boot rather than silently at runtime.
 *
 * Nothing here is `NEXT_PUBLIC_`: every value below is server-only. A secret that
 * reaches the client bundle is not a secret.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  SESSION_SECRET: z
    .string()
    .min(32, 'SESSION_SECRET must be at least 32 characters — generate with crypto.randomBytes(32)'),

  STORAGE_DERIVATIVES_DRIVER: z.enum(['local', 'r2']).default('local'),
  STORAGE_ORIGINALS_DRIVER: z.enum(['local', 'r2', 'gdrive']).default('local'),
  STORAGE_LOCAL_PATH: z.string().default('./var/storage'),

  /**
   * Permit the `local` driver in production. Off by default, and it must stay a
   * deliberate act.
   *
   * The refusal exists because "local" usually means a container's ephemeral
   * filesystem, where the archive is one redeploy away from gone. But on a virtual
   * machine with a persistent block volume it is a legitimate — and free — place
   * to keep photographs, which is the difference between this project costing five
   * dollars a month and costing nothing.
   *
   * Setting this asserts two things about that disk: it survives the process, and
   * something copies it off the machine. `scripts/backup-db.sh` and
   * `npm run backup:originals` are that something; a disk with no second copy is a
   * single point of total loss whatever the driver is called.
   */
  STORAGE_ALLOW_LOCAL_IN_PRODUCTION: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),

  GDRIVE_CLIENT_ID: z.string().optional(),
  GDRIVE_CLIENT_SECRET: z.string().optional(),
  GDRIVE_REFRESH_TOKEN: z.string().optional(),
  GDRIVE_FOLDER_ID: z.string().optional(),

  /**
   * Run the derivative worker inside the web server instead of as its own process.
   *
   * Off by default, because the separation is real: a resize is slow and
   * memory-hungry, and keeping it out of the request handler is why it was built as
   * a second process in the first place.
   *
   * It exists because free hosting will not run a second always-on process, and
   * without a worker an upload never gains the thumbnail that makes it visible —
   * so the archive appears to accept photographs and then lose them. Sharing one
   * process is a worse shape than two; it is a far better one than none.
   *
   * Safe to enable on several instances at once: jobs are claimed with
   * `FOR UPDATE SKIP LOCKED`, so no two workers take the same photo.
   */
  WORKER_IN_PROCESS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  APP_ORIGIN: z.string().url().default('http://localhost:3000'),
  DELETED_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(52_428_800),

  /**
   * Soft ceiling on total stored bytes, in bytes. Default 9 GB.
   *
   * Free object-storage tiers fail opaquely once exhausted — writes start erroring
   * with something that reads like a transient fault. This ceiling sits below the
   * tier limit (Cloudflare R2's free tier is 10 GB) so uploads are refused with a
   * sentence explaining why, and the admin dashboard can show headroom before anyone
   * hits it. Raise it, or set it very high, once storage is paid for.
   */
  STORAGE_SOFT_QUOTA_BYTES: z.coerce.number().int().positive().default(9_663_676_416),

  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

function load() {
  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}\n\nSee .env.example.`);
  }

  const env = parsed.data;

  // Cross-field checks the shape alone cannot express.
  if (env.STORAGE_DERIVATIVES_DRIVER === 'r2' || env.STORAGE_ORIGINALS_DRIVER === 'r2') {
    const missing = (
      ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'] as const
    ).filter((k) => !env[k]);
    if (missing.length > 0) {
      throw new Error(`R2 storage selected but missing: ${missing.join(', ')}`);
    }
  }

  if (env.STORAGE_ORIGINALS_DRIVER === 'gdrive') {
    const missing = (
      ['GDRIVE_CLIENT_ID', 'GDRIVE_CLIENT_SECRET', 'GDRIVE_REFRESH_TOKEN', 'GDRIVE_FOLDER_ID'] as const
    ).filter((k) => !env[k]);
    if (missing.length > 0) {
      throw new Error(`Google Drive storage selected but missing: ${missing.join(', ')}`);
    }
  }

  /*
   * Deployment-shape checks.
   *
   * Skipped during `next build`, which sets NODE_ENV=production while merely
   * compiling: a build machine legitimately has no storage credentials and no HTTPS
   * origin, and failing there would only force placeholder secrets into CI.
   *
   * These still run when the server actually starts, which is the moment that
   * matters — a misconfigured deployment refuses to boot rather than quietly
   * serving private photos from a non-durable disk over plain HTTP.
   */
  const isBuilding = process.env.NEXT_PHASE === 'phase-production-build';

  if (env.NODE_ENV === 'production' && !isBuilding) {
    const usesLocal =
      env.STORAGE_DERIVATIVES_DRIVER === 'local' || env.STORAGE_ORIGINALS_DRIVER === 'local';

    if (usesLocal && !env.STORAGE_ALLOW_LOCAL_IN_PRODUCTION) {
      throw new Error(
        'The "local" storage driver is not durable on ephemeral hosting, where a redeploy ' +
          'takes the archive with it.\n' +
          'On a machine with a persistent disk it is a reasonable — and free — choice: set ' +
          'STORAGE_ALLOW_LOCAL_IN_PRODUCTION=true to say that is what this is, and make sure ' +
          'something copies STORAGE_LOCAL_PATH off the machine (see docs/OPERATIONS.md).',
      );
    }

    if (usesLocal) {
      console.warn(
        `[storage] Photographs are being kept on this machine at ${env.STORAGE_LOCAL_PATH}. ` +
          'Nothing else has a copy unless you have scheduled the backups.',
      );
    }
    if (!env.APP_ORIGIN.startsWith('https://')) {
      throw new Error('APP_ORIGIN must be https:// in production — session cookies are Secure-only.');
    }
  }

  return env;
}

export const env = load();
export type Env = typeof env;
