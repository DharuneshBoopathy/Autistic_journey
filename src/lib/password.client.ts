/**
 * Password policy constants safe to import from client components.
 *
 * `password.ts` pulls in the native Argon2 binding and must never reach the browser
 * bundle, so the shared numbers live here on their own. The client uses them only to
 * render `minLength` and help text — the actual check is `validatePassword()` on the
 * server, which is what enforces the policy.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 512;
