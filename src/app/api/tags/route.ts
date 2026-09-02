import { json, requireApiUser } from '@/lib/api';
import { listTags } from '@/lib/taxonomy';

export const runtime = 'nodejs';

/** Tags in use on photos the viewer can see — never the whole tag table. */
export async function GET() {
  const auth = await requireApiUser();
  if (auth.error) return auth.error;
  return json({ tags: await listTags(auth.user) });
}
