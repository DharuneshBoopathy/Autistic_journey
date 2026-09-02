import { hash, verify, type Algorithm } from '@node-rs/argon2';

/**
 * `Algorithm` is declared as an ambient `const enum`, which `isolatedModules`
 * forbids importing as a value. The variant number is fixed by the Argon2 spec
 * (argon2d = 0, argon2i = 1, argon2id = 2), so naming it here is safe and keeps the
 * choice explicit rather than relying on the library's default.
 */
const ARGON2ID = 2 as Algorithm;

/**
 * Argon2id parameters, following OWASP's current password-storage guidance:
 * 19 MiB of memory, 2 iterations, 1 degree of parallelism.
 *
 * Argon2id (not bcrypt or PBKDF2) because its memory-hardness is what actually
 * degrades GPU and ASIC cracking of a leaked table.
 */
const OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(digest: string, password: string): Promise<boolean> {
  try {
    return await verify(digest, password, OPTIONS);
  } catch {
    // A malformed stored digest must read as "wrong password", never as an error
    // that distinguishes this account from any other.
    return false;
  }
}

/**
 * A real Argon2id digest of a fixed dummy value, used to equalise login timing.
 *
 * Without this, a login for an address that does not exist returns as soon as the
 * user lookup misses, while a real address pays for a full Argon2 verification.
 * That difference is measurable, and it turns the login form into an oracle for
 * "is this person in the batch?" — which for a private archive leaks membership,
 * not just an account. Callers verify against this when no user is found.
 */
let dummyDigest: string | null = null;

export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyDigest ??= await hashPassword('not-a-real-password-placeholder');
  await verifyPassword(dummyDigest, password);
  return false;
}

/**
 * Password policy.
 *
 * Length is the requirement that actually matters; composition rules mostly push
 * people towards predictable substitutions. The upper bound exists because Argon2
 * hashing cost scales with input, making an unbounded field a cheap DoS.
 *
 * The constants live in `password.client.ts` so form components can render them
 * without dragging the native Argon2 binding into the browser bundle. This module
 * is where they are actually enforced.
 */
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './password.client';

export { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH };

export function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  }
  return null;
}
