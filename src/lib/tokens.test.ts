import { describe, expect, it } from 'vitest';
import {
  generateInviteCode,
  generateToken,
  hashIp,
  hashToken,
  normalizeEmail,
  normalizeInviteCode,
  safeEqualHex,
} from './tokens';

describe('generateToken', () => {
  it('produces URL-safe tokens with no padding', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 1000 }, () => generateToken()));
    expect(seen.size).toBe(1000);
  });
});

describe('hashToken', () => {
  it('is deterministic and hides the input', () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toContain(token);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs for different inputs', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });
});

describe('safeEqualHex', () => {
  it('matches identical digests and rejects others', () => {
    const h = hashToken('secret');
    expect(safeEqualHex(h, h)).toBe(true);
    expect(safeEqualHex(h, hashToken('other'))).toBe(false);
  });

  it('rejects mismatched lengths and non-hex without throwing', () => {
    expect(safeEqualHex('abcd', 'ab')).toBe(false);
    expect(safeEqualHex('zzzz', 'zzzz')).toBe(false);
  });
});

describe('generateInviteCode', () => {
  it('is formatted in four transcribable groups', () => {
    expect(generateInviteCode()).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
  });

  it('excludes glyphs that are ambiguous when read aloud', () => {
    const sample = Array.from({ length: 300 }, generateInviteCode).join('');
    for (const ambiguous of ['I', 'O', '0', '1']) {
      expect(sample).not.toContain(ambiguous);
    }
  });

  it('uses the whole alphabet — rejection sampling must not bias the output', () => {
    const chars = new Set(Array.from({ length: 500 }, generateInviteCode).join('').replace(/-/g, ''));
    expect(chars.size).toBe(32);
  });

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 1000 }, generateInviteCode));
    expect(seen.size).toBe(1000);
  });
});

describe('normalizeInviteCode', () => {
  const canonical = 'K7NP-3RTV-9WXY-2QHM';

  it.each([
    ['already canonical', 'K7NP-3RTV-9WXY-2QHM'],
    ['lower case', 'k7np-3rtv-9wxy-2qhm'],
    ['no separators', 'K7NP3RTV9WXY2QHM'],
    ['spaces instead of dashes', 'K7NP 3RTV 9WXY 2QHM'],
    ['surrounding whitespace', '  K7NP-3RTV-9WXY-2QHM  '],
    ['mixed junk', 'k7np_3rtv/9wxy.2qhm'],
  ])('accepts a code entered as %s', (_label, input) => {
    expect(normalizeInviteCode(input)).toBe(canonical);
  });

  it('round-trips generated codes', () => {
    for (let i = 0; i < 100; i++) {
      const code = generateInviteCode();
      expect(normalizeInviteCode(code.toLowerCase().replace(/-/g, ''))).toBe(code);
    }
  });
});

describe('normalizeEmail', () => {
  it('folds case and trims, so one address cannot be registered twice', () => {
    expect(normalizeEmail('  Alice@Example.COM ')).toBe('alice@example.com');
    expect(normalizeEmail('ALICE@EXAMPLE.COM')).toBe(normalizeEmail('alice@example.com'));
  });
});

describe('hashIp', () => {
  it('is stable per (ip, secret) and does not contain the address', () => {
    const digest = hashIp('203.0.113.7', 'secret');
    expect(digest).toBe(hashIp('203.0.113.7', 'secret'));
    expect(digest).not.toContain('203.0.113.7');
    expect(digest).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is salted — the same address under a different secret differs', () => {
    expect(hashIp('203.0.113.7', 'a')).not.toBe(hashIp('203.0.113.7', 'b'));
  });
});
