import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Liveness and readiness for whatever is running this.
 *
 * Deliberately says almost nothing. A health endpoint is reachable without a
 * session — that is the point of it — so it must not report a version, a hostname,
 * a migration state, a row count or an error message. Any of those would be free
 * reconnaissance for anyone who finds the URL, and none of them help a load
 * balancer decide whether to send traffic here.
 *
 * It does check the database, because an app that cannot reach Postgres can serve
 * this page and nothing else; a check that only proved Node was running would keep
 * a useless instance in rotation.
 */
export async function GET() {
  try {
    await db.execute(sql`SELECT 1`);
  } catch {
    // The reason is logged where operators can see it, never returned.
    console.error('[health] database unreachable');
    return NextResponse.json(
      { status: 'unavailable' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }

  return NextResponse.json({ status: 'ok' }, { headers: { 'cache-control': 'no-store' } });
}
