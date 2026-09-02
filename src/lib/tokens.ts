import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Opaque token primitives, shared by sessions and invite codes.
 *
 * The pattern throughout: generate a high-entropy random token, hand the plaintext
 * to the user exactly once, and persist only its SHA-256. A database dump then
 * yields no usable sessions and no redeemable invite codes.
 *
 * SHA-256 (not Argon2) is correct here specifically because these are 128+ bit
 * random values, not passwords. There is no dictionary to attack, so a slow hash
 * would buy nothing and cost a lookup on every request.
 */

/** 256 bits of entropy, URL-safe. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

const HEX = /^[0-9a-f]+$/i;

/**
 * Compare two hex digests without leaking, through timing, how many leading
 * characters matched.
 *
 * The explicit hex validation is load-bearing, not defensive noise:
 * `Buffer.from('zz', 'hex')` does not throw — Node truncates at the first invalid
 * character and returns an empty buffer. Without the check, any two equal-length
 * non-hex strings would decode to two empty buffers and compare *equal*.
 */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  if (!HEX.test(a) || !HEX.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
const INVITE_GROUPS = 4;
const INVITE_GROUP_LEN = 4;

/**
 * A human-transcribable invite code, e.g. `K7NP-3RTV-9WXY-2QHM`.
 *
 * Ambiguous glyphs (I, O, 0, 1) are excluded so a code read aloud or copied off a
 * screen does not fail. 16 characters from a 32-symbol alphabet is 80 bits — far
 * beyond guessing, and invites are rate-limited and expiring regardless.
 */
export function generateInviteCode(): string {
  const needed = INVITE_GROUPS * INVITE_GROUP_LEN;
  const chars: string[] = [];

  // Rejection sampling keeps the distribution uniform: 256 is not a multiple of 32,
  // so taking a raw byte modulo the alphabet length would bias the early symbols.
  const limit = 256 - (256 % INVITE_ALPHABET.length);
  while (chars.length < needed) {
    for (const byte of randomBytes(needed)) {
      if (byte >= limit) continue;
      chars.push(INVITE_ALPHABET[byte % INVITE_ALPHABET.length]!);
      if (chars.length === needed) break;
    }
  }

  return Array.from({ length: INVITE_GROUPS }, (_, g) =>
    chars.slice(g * INVITE_GROUP_LEN, (g + 1) * INVITE_GROUP_LEN).join(''),
  ).join('-');
}

/**
 * Accept an invite code however the user typed it — lower case, spaces instead of
 * dashes, dashes missing entirely — and reduce it to one canonical form before
 * hashing, so lookup succeeds regardless of transcription style.
 */
export function normalizeInviteCode(input: string): string {
  const stripped = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return (
    stripped.match(new RegExp(`.{1,${INVITE_GROUP_LEN}}`, 'g'))?.join('-') ?? stripped
  );
}

/**
 * Emails are stored lower-cased and trimmed, and the unique index is on that
 * stored value — so `Alice@x` cannot register alongside `alice@x`.
 */
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

/**
 * Hash an IP for correlation without retaining the address itself. Salted with the
 * session secret so the digests are not reversible via a rainbow table of the
 * (small) IPv4 space.
 */
export function hashIp(ip: string, secret: string): string {
  return createHash('sha256').update(`${secret}:${ip}`, 'utf8').digest('hex').slice(0, 32);
}
