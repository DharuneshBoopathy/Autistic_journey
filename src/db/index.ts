import { drizzle } from 'drizzle-orm/postgres-js';
import { sql as sqlExpr } from 'drizzle-orm';
import postgres from 'postgres';
import { env } from '@/lib/env';
import * as schema from './schema';

/**
 * Single pooled connection, reused across hot reloads in development so that
 * `next dev` does not exhaust the database's connection limit.
 */
const globalForDb = globalThis as unknown as { __client?: ReturnType<typeof postgres> };

export const client =
  globalForDb.__client ??
  postgres(env.DATABASE_URL, {
    max: env.NODE_ENV === 'production' ? 10 : 3,
    idle_timeout: 20,
    // postgres.js parameterises everything by default; there is no string
    // interpolation path into SQL anywhere in this codebase.
    prepare: true,
  });

if (env.NODE_ENV !== 'production') globalForDb.__client = client;

export const db = drizzle(client, { schema });

export type Db = typeof db;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export { schema };

/** Identity the authorization predicate resolves against. */
export type Viewer = { id: string; batchId: string };

/**
 * Run `fn` with the viewer identity bound to the transaction. This is the only
 * supported way to read photos.
 *
 * The `visible_photos` view reads `app.viewer_id` via `current_setting(..., true)`,
 * which yields NULL when unset. Every branch of the visibility predicate compares
 * against that value, so an unset viewer returns **zero rows** rather than all rows —
 * forgetting to establish a viewer fails closed, which is the whole point.
 *
 * `set_config(..., true)` scopes the setting to the transaction, so it cannot leak
 * onto the next request that borrows this pooled connection.
 */
export async function withViewer<T>(viewer: Viewer, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      // Parameterised — viewer ids never reach the SQL text.
      sqlExpr`select set_config('app.viewer_id', ${viewer.id}::text, true),
                     set_config('app.viewer_batch_id', ${viewer.batchId}::text, true)`,
    );
    return fn(tx);
  });
}
