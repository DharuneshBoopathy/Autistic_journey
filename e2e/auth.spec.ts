import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';

/**
 * End-to-end authentication and access-control checks against a real browser and a
 * real database. These assert behaviour that unit tests cannot: that the session
 * cookie is actually set with the right flags, that redirects fire, and that an
 * unapproved account genuinely cannot reach the archive.
 *
 * Requires a running app (webServer, see playwright.config.ts) and DATABASE_URL.
 */

const sql = postgres(process.env.DATABASE_URL!, { max: 2 });

/**
 * The form's own error message.
 *
 * Deliberately not `getByRole('alert')`: Next's development overlay renders its own
 * element with that role, so the bare lookup matches two nodes and resolves to
 * whichever exists first — which made this suite fail intermittently with an empty
 * string. Scoping to the form pins it to our message.
 */
function formError(page: Page) {
  return page.locator('form [role="alert"]');
}

const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = 'correct-horse-battery-staple';

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

test('anonymous visitors are redirected away from the gallery', async ({ page }) => {
  await page.goto('/gallery');
  await expect(page).toHaveURL(/\/login/);
});

test('a wrong password is rejected without revealing whether the account exists', async ({
  page,
}) => {
  await page.goto('/login');
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', 'definitely-not-the-password');
  await page.click('button[type="submit"]');

  const realAccount = await formError(page).textContent();
  expect(realAccount).toContain('Incorrect email or password');

  await page.goto('/login');
  await page.fill('input[name="email"]', 'nobody-here@example.com');
  await page.fill('input[name="password"]', 'definitely-not-the-password');
  await page.click('button[type="submit"]');

  // The message for a non-existent account must be byte-identical to the message
  // for a real account with a bad password.
  expect(await formError(page).textContent()).toBe(realAccount);
});

test('a valid login reaches the gallery and sets a hardened session cookie', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', ADMIN_PASSWORD);
  await page.click('button[type="submit"]');

  await expect(page).toHaveURL(/\/gallery/);
  // Scoped to the header: the same name also appears in the "Uploaded by" facet, so
  // an unscoped text lookup matches twice and fails Playwright's strict mode.
  await expect(page.locator('header').getByText('Archive Admin')).toBeVisible();

  const cookie = (await page.context().cookies()).find((c) => c.name.includes('aj_session'));
  expect(cookie, 'session cookie should be set').toBeDefined();
  expect(cookie!.httpOnly, 'cookie must be httpOnly so XSS cannot read it').toBe(true);
  expect(cookie!.sameSite).toBe('Lax');
  expect(cookie!.path).toBe('/');

  // The cookie must carry an opaque token, not anything derived from the user.
  expect(cookie!.value).not.toContain(ADMIN_EMAIL);
});

test('signing out revokes the session server-side, not just in the browser', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/gallery/);

  const before = await page.context().cookies();
  const token = before.find((c) => c.name.includes('aj_session'))!.value;

  await page.click('button:has-text("Sign out")');
  await expect(page).toHaveURL(/\/login/);

  // Replaying the old cookie must not work — the row is revoked, so restoring the
  // cookie value gains nothing.
  await page.context().addCookies([
    { name: 'aj_session', value: token, domain: 'localhost', path: '/' },
  ]);
  await page.goto('/gallery');
  await expect(page).toHaveURL(/\/login/);
});

test('a pending account cannot sign in until it is approved', async ({ page }) => {
  const email = `pending-${Date.now()}@example.com`;

  // Same Argon2id digest as ADMIN_PASSWORD would produce; created directly so the
  // test does not depend on the invite flow.
  const hashRow = (
    await sql<{ password_hash: string }[]>`
      SELECT password_hash FROM users WHERE email = ${ADMIN_EMAIL}`
  )[0];
  const batchRow = (await sql<{ id: string }[]>`SELECT id FROM batches LIMIT 1`)[0];
  expect(hashRow, 'bootstrap admin must exist — run db:seed first').toBeDefined();
  expect(batchRow, 'a batch must exist — run db:seed first').toBeDefined();

  const hash = hashRow!.password_hash;
  const batchId = batchRow!.id;

  await sql`
    INSERT INTO users (batch_id, email, password_hash, display_name, status)
    VALUES (${batchId}, ${email}, ${hash}, 'Pending Person', 'pending')`;

  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', ADMIN_PASSWORD);
  await page.click('button[type="submit"]');

  await expect(formError(page)).toContainText('awaiting approval');
  await expect(page).not.toHaveURL(/\/gallery/);

  await sql`DELETE FROM users WHERE email = ${email}`;
});

test('a suspended account loses access immediately, mid-session', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/gallery/);

  // Suspend the account while the session is live. Because sessions are resolved
  // server-side on every request rather than trusted from a signed token, the very
  // next navigation must fail.
  await sql`UPDATE users SET status = 'suspended' WHERE email = ${ADMIN_EMAIL}`;
  try {
    await page.goto('/gallery');
    await expect(page).toHaveURL(/\/login/);
  } finally {
    await sql`UPDATE users SET status = 'active' WHERE email = ${ADMIN_EMAIL}`;
  }
});

test('an invalid invite code is rejected', async ({ page }) => {
  await page.goto('/register');
  await page.fill('input[name="inviteCode"]', 'AAAA-BBBB-CCCC-DDDD');
  await page.fill('input[name="email"]', `x-${Date.now()}@example.com`);
  await page.fill('input[name="displayName"]', 'Nobody');
  await page.fill('input[name="password"]', 'a-sufficiently-long-password');
  await page.click('button[type="submit"]');

  await expect(formError(page)).toContainText('not valid');
});

test('a short password is rejected by the server, not only the browser', async ({ page }) => {
  await page.goto('/register');
  await page.fill('input[name="inviteCode"]', 'AAAA-BBBB-CCCC-DDDD');
  await page.fill('input[name="email"]', `y-${Date.now()}@example.com`);
  await page.fill('input[name="displayName"]', 'Nobody');
  // noValidate on the form means this reaches the server, which is the point.
  await page.fill('input[name="password"]', 'short');
  await page.click('button[type="submit"]');

  await expect(formError(page)).toContainText('at least 12 characters');
});
