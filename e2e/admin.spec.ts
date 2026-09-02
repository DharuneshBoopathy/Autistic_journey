import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import path from 'node:path';
import postgres from 'postgres';
import sharp from 'sharp';

/**
 * The administrative surface: approvals, suspension, roles, invites, download
 * grants, statistics and the audit log.
 *
 * The theme under test is that admin power is real but bounded — it does not reach
 * across batches, it cannot be used to lock the last administrator out, and every
 * use of it lands in a log that cannot be rewritten.
 */

const sql = postgres(process.env.DATABASE_URL!, { max: 3 });
const ORIGIN = 'http://localhost:3100';
const PASSWORD = 'correct-horse-battery-staple';

const ADMIN = 'admin@example.com';
const MEMBER = 'member-adm@example.com';

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
  const n = seed * 5171 + RUN;
  return sharp({
    create: { width: 400 + (n % 7), height: 300 + (n % 5), channels: 3, background: { r: n % 255, g: 90, b: 120 } },
  })
    .jpeg()
    .toBuffer();
}

async function upload(request: APIRequestContext, bytes: Buffer, visibility: string) {
  const response = await request.post('/api/upload', {
    headers: { origin: ORIGIN },
    multipart: { file: { name: 'a.jpg', mimeType: 'image/jpeg', buffer: bytes }, visibility },
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
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(stderr))));
  });
}

test.beforeAll(async () => {
  const [batch] = await sql<{ id: string }[]>`SELECT id FROM batches LIMIT 1`;
  const [admin] = await sql<{ password_hash: string }[]>`
    SELECT password_hash FROM users WHERE email = ${ADMIN}`;
  expect(batch, 'run db:seed first').toBeDefined();

  await sql`
    INSERT INTO users (batch_id, email, password_hash, display_name, role, status)
    VALUES (${batch!.id}, ${MEMBER}, ${admin!.password_hash}, 'Ordinary Member', 'member', 'active')
    ON CONFLICT (email) DO UPDATE
      SET status = 'active', role = 'member', failed_login_count = 0, locked_until = NULL`;
});

test.afterAll(async () => {
  await sql.end();
});

test.beforeEach(async () => {
  await sql`TRUNCATE rate_limits`;
  await sql`UPDATE users SET failed_login_count = 0, locked_until = NULL`;
});

test('the admin surface is invisible to ordinary members', async ({ page }) => {
  await login(page, MEMBER);

  // 404 throughout, not 403 — a member probing should not learn the admin routes
  // even exist, let alone that they merely lack the rank.
  for (const url of ['/api/admin/stats', '/api/admin/members', '/api/admin/failures', '/api/admin/audit', '/api/admin/invites', '/api/admin/download-grants']) {
    expect((await page.request.get(url)).status(), url).toBe(404);
  }
});

test('an admin approves a pending registration, which then can sign in', async ({ page }) => {
  const email = `pending-${RUN}@example.com`;
  const [batch] = await sql<{ id: string }[]>`SELECT id FROM batches LIMIT 1`;
  const [admin] = await sql<{ password_hash: string }[]>`
    SELECT password_hash FROM users WHERE email = ${ADMIN}`;

  await sql`
    INSERT INTO users (batch_id, email, password_hash, display_name, status)
    VALUES (${batch!.id}, ${email}, ${admin!.password_hash}, 'Hopeful', 'pending')
    ON CONFLICT (email) DO UPDATE SET status = 'pending'`;

  // Before approval, the correct password still does not get in.
  await page.context().clearCookies();
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page.locator('form [role="alert"]')).toContainText('awaiting approval');

  await login(page, ADMIN);
  const [pending] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}`;

  const listed = await (await page.request.get('/api/admin/members?status=pending')).json();
  expect(listed.members.some((m: { id: string }) => m.id === pending!.id)).toBe(true);

  expect(
    (await page.request.post(`/api/admin/members/${pending!.id}`, {
      headers: { origin: ORIGIN },
      data: { action: 'approve' },
    })).status(),
  ).toBe(200);

  await login(page, email);
  await expect(page).toHaveURL(/\/gallery/);

  await sql`DELETE FROM users WHERE email = ${email}`;
});

test('suspending a member ends their live session immediately', async ({ browser }) => {
  const adminCtx = await browser.newContext();
  const memberCtx = await browser.newContext();
  const adminPage = await adminCtx.newPage();
  const memberPage = await memberCtx.newPage();

  await login(adminPage, ADMIN);
  await login(memberPage, MEMBER);
  await expect(memberPage).toHaveURL(/\/gallery/);

  const [member] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${MEMBER}`;

  try {
    expect(
      (await adminPage.request.post(`/api/admin/members/${member!.id}`, {
        headers: { origin: ORIGIN },
        data: { action: 'suspend' },
      })).status(),
    ).toBe(200);

    // The member's next navigation fails, without waiting for their session to expire.
    await memberPage.goto('/gallery');
    await expect(memberPage).toHaveURL(/\/login/);
  } finally {
    await sql`UPDATE users SET status = 'active' WHERE email = ${MEMBER}`;
    await adminCtx.close();
    await memberCtx.close();
  }
});

test('an admin cannot suspend or demote themselves', async ({ page }) => {
  await login(page, ADMIN);
  const [admin] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${ADMIN}`;

  // Locking the last administrator out is a support call, not a security control.
  const suspend = await page.request.post(`/api/admin/members/${admin!.id}`, {
    headers: { origin: ORIGIN },
    data: { action: 'suspend' },
  });
  expect(suspend.status()).toBe(422);
  expect((await suspend.json()).error).toContain('your own account');

  const demote = await page.request.post(`/api/admin/members/${admin!.id}`, {
    headers: { origin: ORIGIN },
    data: { action: 'setRole', role: 'member' },
  });
  expect(demote.status()).toBe(422);

  const [still] = await sql<{ status: string; role: string }[]>`
    SELECT status, role FROM users WHERE email = ${ADMIN}`;
  expect(still!.status).toBe('active');
  expect(still!.role).toBe('admin');
});

test('an invite code is returned exactly once and never again', async ({ page }) => {
  await login(page, ADMIN);

  const created = await page.request.post('/api/admin/invites', {
    headers: { origin: ORIGIN },
    data: { maxUses: 1, expiresInDays: 7 },
  });
  expect(created.status()).toBe(201);

  const invite = await created.json();
  expect(invite.code).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);

  // Listing shows the invite exists but cannot reproduce the code — only its hash
  // was stored, so a database dump yields nothing redeemable.
  const listed = await (await page.request.get('/api/admin/invites')).json();
  const row = listed.invites.find((i: { id: string }) => i.id === invite.id);
  expect(row).toBeDefined();
  expect(JSON.stringify(row)).not.toContain(invite.code);
});

test('a download grant lets one member fetch one original, exactly once', async ({ page }) => {
  await login(page, ADMIN);
  const photoId = await upload(page.request, await fixture(1), 'batch');
  await processQueue();

  const [member] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${MEMBER}`;

  // Without a grant, a member cannot reach the original at all.
  await login(page, MEMBER);
  expect((await page.request.get(`/api/photos/${photoId}/original`)).status()).toBe(404);

  await login(page, ADMIN);
  const granted = await page.request.post('/api/admin/download-grants', {
    headers: { origin: ORIGIN },
    data: { photoId, userId: member!.id, reason: 'Printing for the yearbook' },
  });
  expect(granted.status()).toBe(201);

  await login(page, MEMBER);
  const first = await page.request.get(`/api/photos/${photoId}/original`);
  expect(first.status()).toBe(200);
  expect(first.headers()['content-disposition']).toContain('attachment');

  // Single use: the second attempt is refused.
  expect((await page.request.get(`/api/photos/${photoId}/original`)).status()).toBe(404);

  // And the download is on the record, attributed to the grant rather than a role.
  const [entry] = await sql<{ metadata: Record<string, unknown> }[]>`
    SELECT metadata FROM audit_logs
     WHERE target_id = ${photoId} AND action = 'photo.original.downloaded'
     ORDER BY created_at DESC LIMIT 1`;
  expect(entry!.metadata.via).toBe('download_grant');
});

test('an expired grant does not work', async ({ page }) => {
  await login(page, ADMIN);
  const photoId = await upload(page.request, await fixture(2), 'batch');
  await processQueue();

  const [member] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${MEMBER}`;
  await page.request.post('/api/admin/download-grants', {
    headers: { origin: ORIGIN },
    data: { photoId, userId: member!.id },
  });

  await sql`UPDATE download_grants SET expires_at = now() - interval '1 minute'
             WHERE photo_id = ${photoId}::uuid AND user_id = ${member!.id}::uuid`;

  await login(page, MEMBER);
  expect((await page.request.get(`/api/photos/${photoId}/original`)).status()).toBe(404);
});

test('statistics report storage headroom and queue state', async ({ page }) => {
  await login(page, ADMIN);
  const stats = await (await page.request.get('/api/admin/stats')).json();

  expect(stats.storage.quotaBytes).toBeGreaterThan(0);
  expect(stats.storage.totalBytes).toBeGreaterThanOrEqual(0);
  expect(stats.storage.remainingBytes).toBe(
    Math.max(0, stats.storage.quotaBytes - stats.storage.totalBytes),
  );
  expect(stats.photos).toHaveProperty('ready');
  expect(stats.members).toHaveProperty('active');
  expect(stats.jobs).toHaveProperty('queued');
});

test('the audit log records admin actions and cannot be rewritten', async ({ page }) => {
  await login(page, ADMIN);
  const [member] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${MEMBER}`;

  await page.request.post(`/api/admin/members/${member!.id}`, {
    headers: { origin: ORIGIN },
    data: { action: 'setRole', role: 'moderator' },
  });

  const log = await (await page.request.get('/api/admin/audit?action=user.role.changed')).json();
  const entry = log.entries.find((e: { targetId: string }) => e.targetId === member!.id);
  expect(entry).toBeDefined();
  expect(entry.metadata.to).toBe('moderator');
  expect(entry.actorEmail).toBe(ADMIN);

  // The table refuses rewriting, so the record of what an admin did survives the
  // admin themselves.
  await expect(sql`UPDATE audit_logs SET action = 'tampered' WHERE id = ${entry.id}`).rejects.toThrow(
    /append-only/,
  );

  await sql`UPDATE users SET role = 'member' WHERE email = ${MEMBER}`;
});

test('uploads are refused once the storage quota is reached', async ({ page }) => {
  await login(page, ADMIN);

  // Drive the accounting past the ceiling without actually storing gigabytes: the
  // quota reads summed bytes, so an inflated row is indistinguishable from real use.
  const marker = await upload(page.request, await fixture(3), 'private');
  await sql`UPDATE photos SET original_bytes = 20000000000 WHERE id = ${marker}::uuid`;

  try {
    const response = await page.request.post('/api/upload', {
      headers: { origin: ORIGIN },
      multipart: {
        file: { name: 'over.jpg', mimeType: 'image/jpeg', buffer: await fixture(4) },
        visibility: 'private',
      },
    });

    // 507 Insufficient Storage, with an explanation — not an opaque 500 from the
    // storage provider, and not the 415 that means "not an image".
    expect(response.status()).toBe(507);
    expect((await response.json()).error).toContain('storage limit');
  } finally {
    await sql`UPDATE photos SET original_bytes = 1000 WHERE id = ${marker}::uuid`;
  }
});
