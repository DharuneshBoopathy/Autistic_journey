/*
 * Deliberately no `import 'server-only'` here.
 *
 * That guard resolves to a module which throws unless the importer is running under
 * Next's `react-server` condition — which is exactly right for request-handling code,
 * but this module is also imported by the standalone worker process (`npm run
 * worker`), where it would throw at startup.
 *
 * Nothing here is safe to ship to a browser: it reads storage credentials from the
 * environment. Modules that are *only* reachable from a request keep the guard
 * (see `session.ts`, `auth.ts`, `photos.ts`); this one relies on the fact that no
 * client component imports it, and on the absence of any `NEXT_PUBLIC_` value in
 * `env.ts` to make an accidental leak inert.
 */
import path from 'node:path';
import { env } from '@/lib/env';
import { GDriveStorage } from './gdrive';
import { LocalStorage } from './local';
import { R2Storage } from './r2';
import type { StorageAdapter } from './types';

export * from './types';
export { LocalStorage } from './local';
export { R2Storage } from './r2';
export { GDriveStorage } from './gdrive';

function build(driver: 'local' | 'r2' | 'gdrive'): StorageAdapter {
  switch (driver) {
    case 'local':
      /*
       * The `turbopackIgnore` comment matters more than it looks.
       *
       * A `path.resolve` the bundler cannot evaluate makes its file tracer assume
       * the whole project might be read at runtime, so `output: 'standalone'`
       * copied the entire repository — src, tests, scripts, e2e — into the
       * deployment bundle. This tells it the path is resolved at runtime and not a
       * module to follow.
       *
       * Nothing is weakened by it: the local driver is refused in production by
       * `env.ts`, and storage keys are still generated server-side, so this path is
       * never joined with anything a user supplied.
       */
      return new LocalStorage(
        path.resolve(/* turbopackIgnore: true */ process.cwd(), env.STORAGE_LOCAL_PATH),
      );

    case 'r2':
      return new R2Storage({
        accountId: env.R2_ACCOUNT_ID!,
        accessKeyId: env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
        bucket: env.R2_BUCKET!,
      });

    case 'gdrive':
      return new GDriveStorage({
        clientId: env.GDRIVE_CLIENT_ID!,
        clientSecret: env.GDRIVE_CLIENT_SECRET!,
        refreshToken: env.GDRIVE_REFRESH_TOKEN!,
        folderId: env.GDRIVE_FOLDER_ID!,
      });
  }
}

/*
 * Built once and reused. `env` has already verified that the credentials for each
 * selected driver are present, so these cannot be half-configured.
 */
let derivativesAdapter: StorageAdapter | null = null;
let originalsAdapter: StorageAdapter | null = null;

/** Hot path: thumbnails and previews. Small, regenerable, served on every scroll. */
export function derivativeStorage(): StorageAdapter {
  derivativesAdapter ??= build(env.STORAGE_DERIVATIVES_DRIVER);
  return derivativesAdapter;
}

/** Cold path: originals. Large, irreplaceable, read only for admin downloads. */
export function originalStorage(): StorageAdapter {
  originalsAdapter ??= build(env.STORAGE_ORIGINALS_DRIVER);
  return originalsAdapter;
}

/**
 * Resolve the adapter an existing object was written with.
 *
 * Each row records its driver, so objects stay readable after the configuration
 * changes — switching originals from local disk to Drive does not orphan everything
 * uploaded beforehand.
 */
export function storageByName(name: string): StorageAdapter {
  for (const adapter of [derivativeStorage(), originalStorage()]) {
    if (adapter.name === name) return adapter;
  }
  // A row referencing a driver that is no longer configured is a configuration
  // error, not a missing file — say so rather than reporting the photo as absent.
  throw new Error(
    `No configured storage driver named "${name}". ` +
      'An existing object was written with it; re-enable it or migrate those objects.',
  );
}
