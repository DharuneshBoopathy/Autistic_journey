import { NextResponse } from 'next/server';
import { getApiUser } from '@/lib/auth';
import { RateLimits, consumeRateLimit } from '@/lib/rate-limit';
import { getTimeline, suggestTags, type TimelineFilters } from '@/lib/gallery';

export const runtime = 'nodejs';

/**
 * Timeline pagination and tag suggestions for the client.
 *
 * Both delegate to `src/lib/gallery.ts`, which reads exclusively from
 * `visible_photos` — so this route adds no authorization logic of its own and
 * cannot disagree with the rest of the application about who may see what.
 */
export async function GET(request: Request) {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const limit = await consumeRateLimit(`search:user:${user.id}`, RateLimits.SEARCH_PER_USER);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests.' },
      { status: 429, headers: { 'retry-after': String(limit.retryAfterSeconds) } },
    );
  }

  const url = new URL(request.url);

  // Tag autocomplete is scoped to tags on photos this viewer can already see.
  const suggest = url.searchParams.get('suggest');
  if (suggest !== null) {
    return NextResponse.json(
      { tags: await suggestTags(user, suggest) },
      { headers: { 'cache-control': 'private, no-store' } },
    );
  }

  const filters: TimelineFilters = {};
  for (const key of ['academicYear', 'eventId', 'uploaderId', 'albumId', 'tag', 'campusZone', 'q'] as const) {
    const value = url.searchParams.get(key);
    if (value) filters[key] = value;
  }

  const page = await getTimeline(user, {
    cursor: url.searchParams.get('cursor') ?? undefined,
    filters,
  });

  return NextResponse.json(page, {
    // Timeline contents depend on who is asking; a shared cache must never hold them.
    headers: { 'cache-control': 'private, no-store' },
  });
}
