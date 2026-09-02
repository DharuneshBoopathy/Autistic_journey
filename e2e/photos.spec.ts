import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import path from 'node:path';
import postgres from 'postgres';
import sharp from 'sharp';

/**
 * The claim this suite exists to prove: **image bytes are gated by the same
 * authorization predicate as the metadata.**
 *
 * A gallery that hides a photo from the grid but still serves its bytes to anyone
 * holding the URL has not protected anything. So these tests upload real images,
 * process them, and then try to fetch them as the wrong person.
 */

const sql = postgres(process.env.DATABASE_URL!, { max: 3 });

const ADMIN = { email: 'admin@example.com', password: 'correct-horse-battery-staple' };
const OUTSIDER = { email: 'outsider@example.com', password: 'a-completely-different-password' };

async function login(page: Page, email: string, password: string) {
  // Drop any existing session first. /login redirects an already-authenticated
  // visitor straight to /gallery — correct behaviour, but it means switching
  // identities mid-test needs a clean slate.
  await page.context().clearCookies();
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/gallery/);
}

/**
 * Salt shared by every fixture in this run.
 *
 * De-duplication is keyed on the content digest, so a fixture generated identically
 * on a second run against the same database would be merged into the first run's
 * photo — and tests expecting a freshly-uploaded, still-processing row would instead
 * find a finished one. Varying the pixels per run keeps each run's uploads genuinely
 * new without weakening the de-duplication being tested elsewhere.
 */
const RUN_SALT = Date.now() % 100_000;

async function photoFixture(seed: number): Promise<Buffer> {
  // A distinct image per test, so digests differ and de-duplication does not merge them.
  const n = seed * 977 + RUN_SALT;
  return sharp({
    create: {
      width: 900 + (n % 17),
      height: 600 + (n % 13),
      channels: 3,
      background: { r: n % 255, g: (n * 7) % 255, b: (n * 13) % 255 },
    },
  })
    .jpeg()
    .toBuffer();
}

/**
 * The origin a real browser attaches to a same-origin POST.
 *
 * Playwright's API client is not a browser and sends no `Origin` header, but Chrome
 * and Firefox both send one on same-origin POST/PUT/DELETE. The upload route refuses
 * a request with neither `Origin` nor `Referer`, so tests must send what a browser
 * would — otherwise they would be exercising a path no real client takes. The
 * genuinely cross-origin case is covered by its own test below, and the real
 * in-page `fetch()` path by another.
 */
const ORIGIN = 'http://localhost:3100';

async function upload(
  request: APIRequestContext,
  bytes: Buffer,
  visibility: string,
  name = 'photo.jpg',
): Promise<string> {
  const response = await request.post('/api/upload', {
    headers: { origin: ORIGIN },
    multipart: {
      file: { name, mimeType: 'image/jpeg', buffer: bytes },
      visibility,
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).photoId as string;
}

/**
 * Render derivatives and wait for them, so a test never races the background worker.
 *
 * Spawned as a real process rather than imported: Playwright's transform does not
 * resolve the `@/` path alias, and running the actual entry point exercises the same
 * code path the deployed worker takes.
 */
function processQueue(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', 'src/worker/drain.ts'], {
      cwd: path.resolve(__dirname, '..'),
      env: process.env,
      stdio: 'pipe',
    });

    let stderr = '';
    child.stderr?.on('data', (chunk) => (stderr += String(chunk)));
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`worker drain failed (${code}): ${stderr}`)),
    );
  });
}

test.beforeAll(async () => {
  // A second active member in the same batch, who uploaded nothing.
  const batch = (await sql<{ id: string }[]>`SELECT id FROM batches LIMIT 1`)[0];
  const admin = (
    await sql<{ password_hash: string }[]>`
      SELECT password_hash FROM users WHERE email = ${ADMIN.email}`
  )[0];
  expect(batch, 'run db:seed first').toBeDefined();

  await sql`DELETE FROM users WHERE email = ${OUTSIDER.email}`;
  // Reuse the admin's digest so the outsider's password is known without hashing here.
  await sql`
    INSERT INTO users (batch_id, email, password_hash, display_name, role, status)
    VALUES (${batch!.id}, ${OUTSIDER.email}, ${admin!.password_hash}, 'Outsider', 'member', 'active')`;
});

test.afterAll(async () => {
  await sql.end();
});

/**
 * Clear the login rate-limit counters between tests.
 *
 * The limiter is a production control working exactly as intended: this suite logs
 * in far more often in a few minutes than any real person would, and would otherwise
 * lock itself out partway through. Resetting the counter is the test accommodating
 * the control, not the control being weakened for the test.
 */
test.beforeEach(async () => {
  await sql`TRUNCATE rate_limits`;
  await sql`UPDATE users SET failed_login_count = 0, locked_until = NULL`;
});

test('an uploaded photo becomes viewable only after processing', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  const photoId = await upload(page.request, await photoFixture(1), 'batch');

  // Before the worker runs the row is 'processing', which the predicate excludes —
  // so nothing half-rendered is ever shown.
  expect((await page.request.get(`/api/photos/${photoId}/thumb`)).status()).toBe(404);

  await processQueue();

  const thumb = await page.request.get(`/api/photos/${photoId}/thumb`);
  expect(thumb.status()).toBe(200);
  expect(thumb.headers()['content-type']).toBe('image/webp');
});

test('private photos are invisible to other members, bytes included', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  const privateId = await upload(page.request, await photoFixture(2), 'private');
  const batchId = await upload(page.request, await photoFixture(3), 'batch');
  await processQueue();

  // The uploader sees both.
  expect((await page.request.get(`/api/photos/${privateId}/thumb`)).status()).toBe(200);
  expect((await page.request.get(`/api/photos/${batchId}/thumb`)).status()).toBe(200);

  await login(page, OUTSIDER.email, ADMIN.password);

  // The outsider sees the batch photo and gets nothing at all for the private one —
  // 404, not 403, so the response does not confirm that it exists.
  expect((await page.request.get(`/api/photos/${batchId}/thumb`)).status()).toBe(200);

  const denied = await page.request.get(`/api/photos/${privateId}/thumb`);
  expect(denied.status()).toBe(404);
  expect((await page.request.get(`/api/photos/${privateId}/preview`)).status()).toBe(404);

  // A photo that does not exist at all answers identically, so the two are
  // indistinguishable to someone probing.
  const absent = await page.request.get('/api/photos/00000000-0000-4000-8000-000000000000/thumb');
  expect(absent.status()).toBe(denied.status());
  expect(await absent.text()).toBe(await denied.text());
});

test('anonymous requests get no bytes', async ({ browser }) => {
  const context = await browser.newContext(); // no session cookie
  const response = await context.request.get(
    '/api/photos/00000000-0000-4000-8000-000000000000/thumb',
  );
  expect(response.status()).toBe(401);
  await context.close();
});

test('originals are admin-only, and members cannot download them', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  const photoId = await upload(page.request, await photoFixture(4), 'batch');
  await processQueue();

  const asAdmin = await page.request.get(`/api/photos/${photoId}/original`);
  expect(asAdmin.status()).toBe(200);
  // Forced to download rather than render, so a polyglot original cannot be
  // interpreted as a document by the browser.
  expect(asAdmin.headers()['content-disposition']).toContain('attachment');
  expect(asAdmin.headers()['x-content-type-options']).toBe('nosniff');

  await login(page, OUTSIDER.email, ADMIN.password);
  // The member can view the photo...
  expect((await page.request.get(`/api/photos/${photoId}/preview`)).status()).toBe(200);
  // ...but cannot obtain the original. View is not download.
  expect((await page.request.get(`/api/photos/${photoId}/original`)).status()).toBe(404);
});

test('image responses are never stored in a shared cache', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  const photoId = await upload(page.request, await photoFixture(5), 'batch');
  await processQueue();

  const cacheControl = (await page.request.get(`/api/photos/${photoId}/thumb`)).headers()[
    'cache-control'
  ];
  // A CDN or corporate proxy caching one member's authorized response and replaying
  // it to another would defeat the entire predicate.
  expect(cacheControl).toContain('private');
  expect(cacheControl).toContain('no-store');
});

test('uploads that are not images are refused', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);

  const cases: Array<[string, Buffer, string]> = [
    ['a PHP web shell named .jpg', Buffer.from('<?php system($_GET["c"]); ?>'), 'shell.jpg'],
    ['an SVG with script', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'x.svg'],
    ['a ZIP renamed to .png', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0, 0, 0]), 'a.png'],
    ['an empty file', Buffer.alloc(0), 'empty.jpg'],
  ];

  for (const [label, bytes, name] of cases) {
    const response = await page.request.post('/api/upload', {
      headers: { origin: ORIGIN },
      multipart: {
        file: { name, mimeType: 'image/jpeg', buffer: bytes },
        visibility: 'batch',
      },
    });
    expect(response.status(), `${label} must be refused`).toBe(415);
  }
});

test('an upload with no visibility given defaults to private, not batch-wide', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);

  const response = await page.request.post('/api/upload', {
    headers: { origin: ORIGIN },
    multipart: {
      file: { name: 'no-visibility.jpg', mimeType: 'image/jpeg', buffer: await photoFixture(6) },
      // visibility deliberately omitted
    },
  });
  expect(response.status()).toBe(201);
  const photoId = (await response.json()).photoId as string;
  await processQueue();

  const [row] = await sql<{ visibility: string }[]>`
    SELECT visibility FROM photos WHERE id = ${photoId}::uuid`;
  expect(row!.visibility).toBe('private');

  // And an unrecognised value falls back the same way, rather than being trusted.
  const bogus = await page.request.post('/api/upload', {
    headers: { origin: ORIGIN },
    multipart: {
      file: { name: 'bogus.jpg', mimeType: 'image/jpeg', buffer: await photoFixture(7) },
      visibility: 'everyone',
    },
  });
  const bogusId = (await bogus.json()).photoId as string;
  const [bogusRow] = await sql<{ visibility: string }[]>`
    SELECT visibility FROM photos WHERE id = ${bogusId}::uuid`;
  expect(bogusRow!.visibility).toBe('private');
});

test('re-uploading identical bytes de-duplicates instead of storing twice', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  const bytes = await photoFixture(8);

  const first = await upload(page.request, bytes, 'batch', 'first.jpg');
  const response = await page.request.post('/api/upload', {
    headers: { origin: ORIGIN },
    multipart: {
      file: { name: 'second.jpg', mimeType: 'image/jpeg', buffer: bytes },
      visibility: 'batch',
    },
  });

  expect(response.status()).toBe(201);
  const body = await response.json();
  expect(body.photoId).toBe(first);
  expect(body.duplicate).toBe(true);
});

test('a cross-origin upload is refused', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);

  const response = await page.request.post('/api/upload', {
    headers: { origin: 'https://evil.example' },
    multipart: {
      file: { name: 'x.jpg', mimeType: 'image/jpeg', buffer: await photoFixture(9) },
      visibility: 'batch',
    },
  });
  expect(response.status()).toBe(403);
});

test('a real in-page fetch upload succeeds — the browser path, not a simulated one', async ({
  page,
}) => {
  await login(page, ADMIN.email, ADMIN.password);

  // Runs inside the page, so the browser attaches Origin and the session cookie
  // itself. This is the path the upload UI will actually take.
  const status = await page.evaluate(async () => {
    // A 1x1 GIF is the smallest thing that survives magic-byte validation.
    const gif =
      'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    const bytes = Uint8Array.from(atob(gif), (c) => c.charCodeAt(0));

    const form = new FormData();
    form.append('file', new Blob([bytes], { type: 'image/gif' }), 'tiny.gif');
    form.append('visibility', 'batch');

    const response = await fetch('/api/upload', { method: 'POST', body: form });
    return response.status;
  });

  expect(status).toBe(201);
});
