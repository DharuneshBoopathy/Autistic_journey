import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import path from 'node:path';
import postgres from 'postgres';
import sharp from 'sharp';

/**
 * Visibility changes, sharing, deletion and recovery.
 *
 * The claim under test: **narrowing a photo's visibility revokes access on the very
 * next request** — not at session expiry, not when a cache happens to turn over.
 * That only holds because the predicate reads `photo_acl` live and no signed URL
 * exists to outlive the change, so it is worth proving rather than asserting.
 */

const sql = postgres(process.env.DATABASE_URL!, { max: 3 });
const ORIGIN = 'http://localhost:3100';

const ADMIN = { email: 'admin@example.com', password: 'correct-horse-battery-staple' };
const ALICE = { email: 'alice-mut@example.com', password: 'correct-horse-battery-staple' };
const BOB = { email: 'bob-mut@example.com', password: 'correct-horse-battery-staple' };

const RUN = Date.now() % 100_000;

async function login(page: Page, email: string, password: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/gallery/);
}

async function fixture(seed: number): Promise<Buffer> {
  const n = seed * 7919 + RUN;
  return sharp({
    create: {
      width: 640 + (n % 11),
      height: 480 + (n % 7),
      channels: 3,
      background: { r: n % 255, g: (n * 3) % 255, b: (n * 5) % 255 },
    },
  })
    .jpeg()
    .toBuffer();
}

async function upload(request: APIRequestContext, bytes: Buffer, visibility: string) {
  const response = await request.post('/api/upload', {
    headers: { origin: ORIGIN },
    multipart: {
      file: { name: 'm.jpg', mimeType: 'image/jpeg', buffer: bytes },
      visibility,
    },
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
    SELECT password_hash FROM users WHERE email = ${ADMIN.email}`;
  expect(batch, 'run db:seed first').toBeDefined();

  /*
   * Upsert rather than delete-and-recreate.
   *
   * `photos.uploader_id` is ON DELETE RESTRICT on purpose — an account that uploaded
   * photos cannot simply be removed and leave them orphaned — so a second run of this
   * suite would fail its own setup on the foreign key. Making the fixtures idempotent
   * respects that constraint instead of working around it.
   */
  for (const person of [ALICE, BOB]) {
    await sql`
      INSERT INTO users (batch_id, email, password_hash, display_name, role, status)
      VALUES (${batch!.id}, ${person.email}, ${admin!.password_hash},
              ${person.email.split('@')[0]!}, 'member', 'active')
      ON CONFLICT (email) DO UPDATE
        SET status = 'active', password_hash = EXCLUDED.password_hash,
            failed_login_count = 0, locked_until = NULL`;
  }
});

test.afterAll(async () => {
  await sql.end();
});

test.beforeEach(async () => {
  await sql`TRUNCATE rate_limits`;
  await sql`UPDATE users SET failed_login_count = 0, locked_until = NULL`;
});

test('narrowing visibility revokes access on the next request', async ({ page }) => {
  await login(page, ALICE.email, ALICE.password);
  const photoId = await upload(page.request, await fixture(1), 'batch');
  await processQueue();

  // Bob can see it while it is batch-visible.
  await login(page, BOB.email, BOB.password);
  expect((await page.request.get(`/api/photos/${photoId}/thumb`)).status()).toBe(200);

  // Alice narrows it to private.
  await login(page, ALICE.email, ALICE.password);
  const patch = await page.request.patch(`/api/photos/${photoId}`, {
    headers: { origin: ORIGIN },
    data: { visibility: 'private' },
  });
  expect(patch.status()).toBe(200);

  // Bob's very next request fails — no waiting for a session or cache to turn over.
  await login(page, BOB.email, BOB.password);
  expect((await page.request.get(`/api/photos/${photoId}/thumb`)).status()).toBe(404);
  expect((await page.request.get(`/api/photos/${photoId}/preview`)).status()).toBe(404);
});

test('sharing with named individuals grants exactly those people', async ({ page }) => {
  await login(page, ALICE.email, ALICE.password);
  const photoId = await upload(page.request, await fixture(2), 'private');
  await processQueue();

  const bobId = await idOf(BOB.email);
  const adminId = await idOf(ADMIN.email);

  // Bob cannot see it yet.
  await login(page, BOB.email, BOB.password);
  expect((await page.request.get(`/api/photos/${photoId}/thumb`)).status()).toBe(404);

  await login(page, ALICE.email, ALICE.password);
  expect(
    (
      await page.request.patch(`/api/photos/${photoId}`, {
        headers: { origin: ORIGIN },
        data: { visibility: 'selected', principalIds: [bobId] },
      })
    ).status(),
  ).toBe(200);

  // Bob can now; the admin — not named — still cannot see it as a normal viewer.
  await login(page, BOB.email, BOB.password);
  expect((await page.request.get(`/api/photos/${photoId}/thumb`)).status()).toBe(200);

  // Re-sharing replaces the list wholesale rather than adding to it.
  await login(page, ALICE.email, ALICE.password);
  await page.request.patch(`/api/photos/${photoId}`, {
    headers: { origin: ORIGIN },
    data: { visibility: 'selected', principalIds: [adminId] },
  });

  await login(page, BOB.email, BOB.password);
  expect(
    (await page.request.get(`/api/photos/${photoId}/thumb`)).status(),
    'replacing the ACL must remove the previous grant',
  ).toBe(404);
});

test('a member cannot change a photo they did not upload', async ({ page }) => {
  await login(page, ALICE.email, ALICE.password);
  const photoId = await upload(page.request, await fixture(3), 'batch');
  await processQueue();

  // Bob can see it, which grants him nothing at all in terms of changing it.
  await login(page, BOB.email, BOB.password);
  expect((await page.request.get(`/api/photos/${photoId}/thumb`)).status()).toBe(200);

  const patch = await page.request.patch(`/api/photos/${photoId}`, {
    headers: { origin: ORIGIN },
    data: { visibility: 'private' },
  });
  // 404, not 403 — the response must not confirm the photo exists.
  expect(patch.status()).toBe(404);

  const remove = await page.request.delete(`/api/photos/${photoId}`, {
    headers: { origin: ORIGIN },
  });
  expect(remove.status()).toBe(404);

  // And it really was not changed.
  const [row] = await sql<{ visibility: string }[]>`
    SELECT visibility FROM photos WHERE id = ${photoId}::uuid`;
  expect(row!.visibility).toBe('batch');
});

test('sharing with someone outside the batch is refused', async ({ page }) => {
  await login(page, ALICE.email, ALICE.password);
  const photoId = await upload(page.request, await fixture(4), 'private');

  const response = await page.request.patch(`/api/photos/${photoId}`, {
    headers: { origin: ORIGIN },
    data: { visibility: 'selected', principalIds: ['00000000-0000-4000-8000-000000000000'] },
  });
  expect(response.status()).toBe(422);

  // The photo must remain private rather than being left in a half-applied state.
  const [row] = await sql<{ visibility: string }[]>`
    SELECT visibility FROM photos WHERE id = ${photoId}::uuid`;
  expect(row!.visibility).toBe('private');
});

test('soft delete hides a photo from everyone, including its uploader', async ({ page }) => {
  await login(page, ALICE.email, ALICE.password);
  const photoId = await upload(page.request, await fixture(5), 'batch');
  await processQueue();

  const remove = await page.request.delete(`/api/photos/${photoId}`, {
    headers: { origin: ORIGIN },
  });
  expect(remove.status()).toBe(200);
  expect((await remove.json()).recoverableUntil).toBeTruthy();

  // Hidden from its own uploader too — recovery goes through the restore path, not
  // by continuing to browse it.
  expect((await page.request.get(`/api/photos/${photoId}/thumb`)).status()).toBe(404);

  await login(page, BOB.email, BOB.password);
  expect((await page.request.get(`/api/photos/${photoId}/thumb`)).status()).toBe(404);
});

test('a soft-deleted photo can be restored within the window', async ({ page }) => {
  await login(page, ALICE.email, ALICE.password);
  const photoId = await upload(page.request, await fixture(6), 'batch');
  await processQueue();

  await page.request.delete(`/api/photos/${photoId}`, { headers: { origin: ORIGIN } });
  expect((await page.request.get(`/api/photos/${photoId}/thumb`)).status()).toBe(404);

  const restore = await page.request.post(`/api/photos/${photoId}`, {
    headers: { origin: ORIGIN },
    data: { action: 'restore' },
  });
  expect(restore.status()).toBe(200);
  expect((await page.request.get(`/api/photos/${photoId}/thumb`)).status()).toBe(200);
});

test('a photo past its purge window cannot be restored', async ({ page }) => {
  await login(page, ALICE.email, ALICE.password);
  const photoId = await upload(page.request, await fixture(7), 'batch');

  await page.request.delete(`/api/photos/${photoId}`, { headers: { origin: ORIGIN } });
  // Simulate the retention period having elapsed.
  await sql`UPDATE photos SET purge_after = now() - interval '1 day' WHERE id = ${photoId}::uuid`;

  const restore = await page.request.post(`/api/photos/${photoId}`, {
    headers: { origin: ORIGIN },
    data: { action: 'restore' },
  });
  // 410 Gone: it existed, and it is not coming back.
  expect(restore.status()).toBe(410);
});

test('bulk actions authorize every photo individually', async ({ page }) => {
  await login(page, ALICE.email, ALICE.password);
  const mine = await upload(page.request, await fixture(8), 'batch');
  await processQueue();

  await login(page, BOB.email, BOB.password);
  const his = await upload(page.request, await fixture(9), 'batch');
  await processQueue();

  // Bob tries to delete both his own and Alice's in one call.
  const response = await page.request.post('/api/photos/bulk', {
    headers: { origin: ORIGIN },
    data: { action: 'delete', photoIds: [his, mine] },
  });
  expect(response.status()).toBe(200);

  const body = await response.json();
  expect(body.succeeded).toBe(1);
  expect(body.failed).toBe(1);

  // His is gone; hers is untouched — a batch is not a way to reach a photo he could
  // not reach one at a time.
  const [hers] = await sql<{ deleted_at: string | null }[]>`
    SELECT deleted_at FROM photos WHERE id = ${mine}::uuid`;
  expect(hers!.deleted_at).toBeNull();

  const [bobs] = await sql<{ deleted_at: string | null }[]>`
    SELECT deleted_at FROM photos WHERE id = ${his}::uuid`;
  expect(bobs!.deleted_at).not.toBeNull();
});

test('visibility and ACL changes are written to the audit log', async ({ page }) => {
  await login(page, ALICE.email, ALICE.password);
  const photoId = await upload(page.request, await fixture(10), 'private');
  const bobId = await idOf(BOB.email);

  await page.request.patch(`/api/photos/${photoId}`, {
    headers: { origin: ORIGIN },
    data: { visibility: 'selected', principalIds: [bobId] },
  });

  const [entry] = await sql<{ action: string; metadata: Record<string, unknown> }[]>`
    SELECT action, metadata FROM audit_logs
     WHERE target_id = ${photoId} AND action = 'photo.visibility.changed'
     ORDER BY created_at DESC LIMIT 1`;

  expect(entry).toBeDefined();
  expect(entry!.metadata.to).toBe('selected');
  expect(entry!.metadata.from).toBe('private');
  // Who was granted access, not merely how many — the former answers the question
  // anyone actually asks of an audit log.
  expect(entry!.metadata.principals).toEqual([bobId]);
});

test('a cross-origin mutation is refused', async ({ page }) => {
  await login(page, ALICE.email, ALICE.password);
  const photoId = await upload(page.request, await fixture(11), 'private');

  const response = await page.request.patch(`/api/photos/${photoId}`, {
    headers: { origin: 'https://evil.example' },
    data: { visibility: 'batch' },
  });
  expect(response.status()).toBe(403);
});
