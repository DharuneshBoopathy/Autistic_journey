import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import path from 'node:path';
import postgres from 'postgres';
import sharp from 'sharp';

/**
 * Groups, albums, events and tags.
 *
 * The claim this suite exists to prove: **a grouping is never a grant.** Putting a
 * photo into an album someone can open, or filing it under an event they can browse,
 * must not let them see a photo the visibility model excludes. The naive
 * implementation — joining `album_photos` straight to `photos` — would silently turn
 * every album into a way around the predicate, and would look completely correct.
 */

const sql = postgres(process.env.DATABASE_URL!, { max: 3 });
const ORIGIN = 'http://localhost:3100';
const PASSWORD = 'correct-horse-battery-staple';

const ADMIN = 'admin@example.com';
const ALICE = 'alice-org@example.com';
const BOB = 'bob-org@example.com';
const CAROL = 'carol-org@example.com';

const RUN = Date.now() % 100_000;

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/gallery/);
}

async function fixture(seed: number): Promise<Buffer> {
  const n = seed * 6151 + RUN;
  return sharp({
    create: {
      width: 500 + (n % 9),
      height: 400 + (n % 5),
      channels: 3,
      background: { r: n % 255, g: (n * 11) % 255, b: (n * 17) % 255 },
    },
  })
    .jpeg()
    .toBuffer();
}

async function upload(request: APIRequestContext, bytes: Buffer, visibility: string) {
  const response = await request.post('/api/upload', {
    headers: { origin: ORIGIN },
    multipart: { file: { name: 'o.jpg', mimeType: 'image/jpeg', buffer: bytes }, visibility },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).photoId as string;
}

function processQueue(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', 'src/worker/drain.ts'], {
      cwd: path.resolve(__dirname, '..'),
      env: process.env,
      stdio: 'pipe',
    });
    let stderr = '';
    child.stderr?.on('data', (c) => (stderr += String(c)));
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`drain failed (${code}): ${stderr}`)),
    );
  });
}

async function idOf(email: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}`;
  return row!.id;
}

test.beforeAll(async () => {
  const [batch] = await sql<{ id: string }[]>`SELECT id FROM batches LIMIT 1`;
  const [admin] = await sql<{ password_hash: string }[]>`
    SELECT password_hash FROM users WHERE email = ${ADMIN}`;
  expect(batch, 'run db:seed first').toBeDefined();

  for (const email of [ALICE, BOB, CAROL]) {
    await sql`
      INSERT INTO users (batch_id, email, password_hash, display_name, role, status)
      VALUES (${batch!.id}, ${email}, ${admin!.password_hash}, ${email.split('@')[0]!}, 'member', 'active')
      ON CONFLICT (email) DO UPDATE
        SET status = 'active', failed_login_count = 0, locked_until = NULL`;
  }
});

test.afterAll(async () => {
  await sql.end();
});

test.beforeEach(async () => {
  await sql`TRUNCATE rate_limits`;
  await sql`UPDATE users SET failed_login_count = 0, locked_until = NULL`;
});

test('an album is a grouping, not a grant', async ({ page }) => {
  await login(page, ALICE);

  const secret = await upload(page.request, await fixture(1), 'private');
  const shared = await upload(page.request, await fixture(2), 'batch');
  await processQueue();

  // A batch-visible album containing one private photo and one batch photo.
  const created = await page.request.post('/api/albums', {
    headers: { origin: ORIGIN },
    data: { name: `Trip ${RUN}`, visibility: 'batch' },
  });
  expect(created.status()).toBe(201);
  const albumId = (await created.json()).id as string;

  const added = await page.request.post(`/api/albums/${albumId}/photos`, {
    headers: { origin: ORIGIN },
    data: { photoIds: [secret, shared] },
  });
  expect(added.status()).toBe(200);
  expect((await added.json()).added).toBe(2);

  // Alice sees both.
  const asAlice = await (await page.request.get(`/api/albums/${albumId}`)).json();
  expect(asAlice.photos.map((p: { id: string }) => p.id).sort()).toEqual([secret, shared].sort());

  // Bob can open the album, and sees only the photo he is entitled to.
  await login(page, BOB);
  const response = await page.request.get(`/api/albums/${albumId}`);
  expect(response.status()).toBe(200);

  const asBob = await response.json();
  expect(asBob.photos).toHaveLength(1);
  expect(asBob.photos[0].id).toBe(shared);

  // And the bytes are refused too — the album did not create a back door.
  expect((await page.request.get(`/api/photos/${secret}/thumb`)).status()).toBe(404);
});

test('album counts are per-viewer, not global', async ({ page }) => {
  await login(page, ALICE);
  const secret = await upload(page.request, await fixture(3), 'private');
  const shared = await upload(page.request, await fixture(4), 'batch');
  await processQueue();

  const albumId = (
    await (
      await page.request.post('/api/albums', {
        headers: { origin: ORIGIN },
        data: { name: `Counts ${RUN}`, visibility: 'batch' },
      })
    ).json()
  ).id as string;

  await page.request.post(`/api/albums/${albumId}/photos`, {
    headers: { origin: ORIGIN },
    data: { photoIds: [secret, shared] },
  });

  const mine = (await (await page.request.get('/api/albums')).json()).albums.find(
    (a: { id: string }) => a.id === albumId,
  );
  expect(mine.visibleCount).toBe(2);

  await login(page, BOB);
  const theirs = (await (await page.request.get('/api/albums')).json()).albums.find(
    (a: { id: string }) => a.id === albumId,
  );
  // A count of 2 here would disclose the existence of a photo Bob may not open.
  expect(theirs.visibleCount).toBe(1);
});

test('a private album is invisible to other members', async ({ page }) => {
  await login(page, ALICE);
  const albumId = (
    await (
      await page.request.post('/api/albums', {
        headers: { origin: ORIGIN },
        data: { name: `Private ${RUN}`, visibility: 'private' },
      })
    ).json()
  ).id as string;

  await login(page, BOB);
  expect((await page.request.get(`/api/albums/${albumId}`)).status()).toBe(404);
  const list = (await (await page.request.get('/api/albums')).json()).albums;
  expect(list.find((a: { id: string }) => a.id === albumId)).toBeUndefined();
});

test('group membership grants access, and revoking it takes it away', async ({ page }) => {
  await login(page, ALICE);

  const groupId = (
    await (
      await page.request.post('/api/groups', {
        headers: { origin: ORIGIN },
        data: { name: `Hostel ${RUN}` },
      })
    ).json()
  ).id as string;

  const photoId = await upload(page.request, await fixture(5), 'private');
  await processQueue();

  const bobId = await idOf(BOB);
  const carolId = await idOf(CAROL);

  // Share with the group, and put Bob — but not Carol — in it.
  await page.request.post(`/api/groups/${groupId}/members`, {
    headers: { origin: ORIGIN },
    data: { userId: bobId },
  });
  expect(
    (
      await page.request.patch(`/api/photos/${photoId}`, {
        headers: { origin: ORIGIN },
        data: { visibility: 'group', principalIds: [groupId] },
      })
    ).status(),
  ).toBe(200);

  await login(page, BOB);
  expect((await page.request.get(`/api/photos/${photoId}/thumb`)).status()).toBe(200);

  await login(page, CAROL);
  expect((await page.request.get(`/api/photos/${photoId}/thumb`)).status()).toBe(404);

  // Adding Carol grants access without touching the photo at all.
  await login(page, ALICE);
  await page.request.post(`/api/groups/${groupId}/members`, {
    headers: { origin: ORIGIN },
    data: { userId: carolId },
  });

  await login(page, CAROL);
  expect((await page.request.get(`/api/photos/${photoId}/thumb`)).status()).toBe(200);

  // Removing her takes it away again, on the next request.
  await login(page, ALICE);
  await page.request.delete(`/api/groups/${groupId}/members`, {
    headers: { origin: ORIGIN },
    data: { userId: carolId },
  });

  await login(page, CAROL);
  expect((await page.request.get(`/api/photos/${photoId}/thumb`)).status()).toBe(404);
});

test('deleting a group narrows access rather than widening it', async ({ page }) => {
  await login(page, ALICE);

  const groupId = (
    await (
      await page.request.post('/api/groups', {
        headers: { origin: ORIGIN },
        data: { name: `Doomed ${RUN}` },
      })
    ).json()
  ).id as string;

  const photoId = await upload(page.request, await fixture(6), 'private');
  await processQueue();

  await page.request.post(`/api/groups/${groupId}/members`, {
    headers: { origin: ORIGIN },
    data: { userId: await idOf(BOB) },
  });
  await page.request.patch(`/api/photos/${photoId}`, {
    headers: { origin: ORIGIN },
    data: { visibility: 'group', principalIds: [groupId] },
  });

  await login(page, BOB);
  expect((await page.request.get(`/api/photos/${photoId}/thumb`)).status()).toBe(200);

  await login(page, ALICE);
  expect((await page.request.delete(`/api/groups/${groupId}`, { headers: { origin: ORIGIN } })).status()).toBe(200);

  // The photo is still 'group'-visible but resolves to nobody. Failing closed is the
  // only acceptable direction here.
  await login(page, BOB);
  expect((await page.request.get(`/api/photos/${photoId}/thumb`)).status()).toBe(404);
});

test('a member cannot modify a group or album they do not own', async ({ page }) => {
  await login(page, ALICE);
  const groupId = (
    await (await page.request.post('/api/groups', { headers: { origin: ORIGIN }, data: { name: `Mine ${RUN}` } })).json()
  ).id as string;
  const albumId = (
    await (
      await page.request.post('/api/albums', {
        headers: { origin: ORIGIN },
        data: { name: `Mine ${RUN}`, visibility: 'batch' },
      })
    ).json()
  ).id as string;

  await login(page, BOB);
  expect((await page.request.patch(`/api/groups/${groupId}`, { headers: { origin: ORIGIN }, data: { name: 'hijacked' } })).status()).toBe(404);
  expect((await page.request.delete(`/api/groups/${groupId}`, { headers: { origin: ORIGIN } })).status()).toBe(404);
  expect((await page.request.patch(`/api/albums/${albumId}`, { headers: { origin: ORIGIN }, data: { name: 'hijacked' } })).status()).toBe(404);

  // Bob can *see* the batch-visible album, which grants him no ability to change it.
  expect((await page.request.get(`/api/albums/${albumId}`)).status()).toBe(200);
});

test('a group cannot be used to reach outside the batch', async ({ page }) => {
  await login(page, ALICE);
  const groupId = (
    await (await page.request.post('/api/groups', { headers: { origin: ORIGIN }, data: { name: `Closed ${RUN}` } })).json()
  ).id as string;

  const response = await page.request.post(`/api/groups/${groupId}/members`, {
    headers: { origin: ORIGIN },
    data: { userId: '00000000-0000-4000-8000-000000000000' },
  });
  expect(response.status()).toBe(422);
});

test('tags and events only count photos the viewer can see', async ({ page }) => {
  await login(page, ALICE);
  const secret = await upload(page.request, await fixture(7), 'private');
  const shared = await upload(page.request, await fixture(8), 'batch');
  await processQueue();

  const tag = `trip${RUN}`;
  for (const id of [secret, shared]) {
    expect(
      (await page.request.post(`/api/photos/${id}/tags`, { headers: { origin: ORIGIN }, data: { tags: [tag] } })).status(),
    ).toBe(200);
  }

  const eventId = (
    await (
      await page.request.post('/api/events', { headers: { origin: ORIGIN }, data: { name: `Fest ${RUN}` } })
    ).json()
  ).id as string;

  await page.request.post('/api/photos/bulk', {
    headers: { origin: ORIGIN },
    data: { action: 'setMetadata', photoIds: [secret, shared], eventId },
  });

  const alicesTag = (await (await page.request.get('/api/tags')).json()).tags.find(
    (t: { name: string }) => t.name === tag,
  );
  expect(alicesTag.count).toBe(2);

  await login(page, BOB);
  const bobsTag = (await (await page.request.get('/api/tags')).json()).tags.find(
    (t: { name: string }) => t.name === tag,
  );
  // The tag exists for Bob, but counts only his one photo — a count of 2 would leak.
  expect(bobsTag.count).toBe(1);

  const bobsEvent = (await (await page.request.get('/api/events')).json()).events.find(
    (e: { id: string }) => e.id === eventId,
  );
  expect(bobsEvent.visibleCount).toBe(1);
});

test('a photo the caller cannot see cannot be tagged', async ({ page }) => {
  await login(page, ALICE);
  const secret = await upload(page.request, await fixture(9), 'private');
  await processQueue();

  await login(page, BOB);
  const response = await page.request.post(`/api/photos/${secret}/tags`, {
    headers: { origin: ORIGIN },
    data: { tags: ['nope'] },
  });
  // 404 rather than 403 — tagging must not confirm the id names a real photo.
  expect(response.status()).toBe(404);
});
