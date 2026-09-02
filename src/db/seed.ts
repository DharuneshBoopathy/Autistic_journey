/**
 * Bootstrap: create the first batch and the first administrator.
 *
 * Registration requires an invite, and invites require an admin — so the very first
 * account cannot come through the normal path. It is created here instead, from the
 * command line by whoever controls the server, rather than through any HTTP route.
 * There is deliberately no "first user becomes admin" rule: that is a well-known way
 * to lose an archive to whoever finds it before you do.
 *
 * Usage:
 *   DATABASE_URL=... npm run db:seed -- \
 *     --batch "CSE 2021-2025" --start 2021 --end 2025 \
 *     --email you@example.com --name "Your Name"
 *
 * The password is read from the ADMIN_PASSWORD environment variable so it never
 * lands in shell history or the process list.
 */
import { eq } from 'drizzle-orm';
import { db, schema, client } from './index';
import { hashPassword, validatePassword } from '@/lib/password';
import { normalizeEmail } from '@/lib/tokens';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const batchName = arg('batch');
  const startYear = Number(arg('start'));
  const endYear = Number(arg('end'));
  const emailRaw = arg('email');
  const displayName = arg('name');
  const password = process.env.ADMIN_PASSWORD;

  if (!batchName || !emailRaw || !displayName || !Number.isFinite(startYear) || !Number.isFinite(endYear)) {
    throw new Error(
      'Usage: npm run db:seed -- --batch "NAME" --start YEAR --end YEAR --email EMAIL --name "NAME"\n' +
        '(set ADMIN_PASSWORD in the environment)',
    );
  }
  if (!password) throw new Error('ADMIN_PASSWORD environment variable is required.');

  const problem = validatePassword(password);
  if (problem) throw new Error(problem);

  const email = normalizeEmail(emailRaw);

  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  if (existing.length > 0) {
    throw new Error(`A user with ${email} already exists. Refusing to overwrite it.`);
  }

  const passwordHash = await hashPassword(password);

  const userId = await db.transaction(async (tx) => {
    const [batch] = await tx
      .insert(schema.batches)
      .values({ name: batchName, startYear, endYear })
      .returning({ id: schema.batches.id });

    const [user] = await tx
      .insert(schema.users)
      .values({
        batchId: batch!.id,
        email,
        passwordHash,
        displayName,
        role: 'admin',
        // Active immediately — there is nobody else who could approve it.
        status: 'active',
        approvedAt: new Date(),
      })
      .returning({ id: schema.users.id });

    return user!.id;
  });

  console.warn(`Created batch "${batchName}" and administrator ${email} (${userId}).`);
  console.warn('Sign in, then issue invite codes from the admin portal.');
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => client.end());
