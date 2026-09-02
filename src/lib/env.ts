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

  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),

  GDRIVE_CLIENT_ID: z.string().optional(),
  GDRIVE_CLIENT_SECRET: z.string().optional(),
  GDRIVE_REFRESH_TOKEN: z.string().optional(),
  GDRIVE_FOLDER_ID: z.string().optional(),

  APP_ORIGIN: z.string().url().default('http://localhost:3000'),
  DELETED_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(52_428_800),

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
    if (env.STORAGE_DERIVATIVES_DRIVER === 'local' || env.STORAGE_ORIGINALS_DRIVER === 'local') {
      throw new Error('The "local" storage driver is for development only; it is not durable.');
    }
    if (!env.APP_ORIGIN.startsWith('https://')) {
      throw new Error('APP_ORIGIN must be https:// in production — session cookies are Secure-only.');
    }
  }

  return env;
}

export const env = load();
export type Env = typeof env;
