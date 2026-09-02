import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalStorage } from './local';
import { buildKey } from './types';

describe('buildKey', () => {
  const photoId = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';

  it('derives the key from the server-chosen id, never from the filename', () => {
    const key = buildKey('original', photoId, 'jpg');
    expect(key).toBe('original/a1/b2/a1b2c3d4e5f64789abcdef0123456789.jpg');
  });

  it('fans out across directories so no single prefix holds 100k objects', () => {
    const a = buildKey('thumb', '11112222-3333-4444-5555-666677778888', 'webp');
    const b = buildKey('thumb', '99992222-3333-4444-5555-666677778888', 'webp');
    expect(path.dirname(a)).not.toBe(path.dirname(b));
  });

  it('strips anything non-alphanumeric from the extension', () => {
    // Even if an extension were ever taken from user input, it cannot introduce
    // path separators or traversal sequences.
    expect(buildKey('original', photoId, '../../etc/passwd')).toContain('etcpasswd');
    expect(buildKey('original', photoId, '../../etc/passwd')).not.toContain('/etc/');
    expect(buildKey('original', photoId, 'jp g/../x')).not.toContain('..');
  });

  it('separates the four kinds of object', () => {
    expect(buildKey('quarantine', photoId, 'jpg')).toMatch(/^quarantine\//);
    expect(buildKey('original', photoId, 'jpg')).toMatch(/^original\//);
    expect(buildKey('thumb', photoId, 'webp')).toMatch(/^thumb\//);
    expect(buildKey('preview', photoId, 'webp')).toMatch(/^preview\//);
  });
});

describe('LocalStorage', () => {
  let root: string;
  let storage: LocalStorage;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'aj-storage-'));
    storage = new LocalStorage(root);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('round-trips an object', async () => {
    const body = Buffer.from('some bytes');
    const put = await storage.put('thumb/ab/cd/x.webp', body, { contentType: 'image/webp' });

    expect(put.key).toBe('thumb/ab/cd/x.webp');
    expect(put.bytes).toBe(body.byteLength);
    expect(await storage.get('thumb/ab/cd/x.webp')).toEqual(body);
    expect(await storage.size('thumb/ab/cd/x.webp')).toBe(body.byteLength);
    expect(await storage.exists('thumb/ab/cd/x.webp')).toBe(true);
  });

  it('creates intermediate directories', async () => {
    await storage.put('a/b/c/d/e/deep.bin', Buffer.from('x'), { contentType: 'application/octet-stream' });
    expect(await readFile(path.join(root, 'a/b/c/d/e/deep.bin'), 'utf8')).toBe('x');
  });

  it('reports a missing object as absent rather than throwing', async () => {
    expect(await storage.size('thumb/no/such/object.webp')).toBeNull();
    expect(await storage.exists('thumb/no/such/object.webp')).toBe(false);
  });

  it('deletes idempotently', async () => {
    await storage.put('tmp/gone.bin', Buffer.from('x'), { contentType: 'application/octet-stream' });
    await storage.delete('tmp/gone.bin');
    await storage.delete('tmp/gone.bin'); // must not throw
    expect(await storage.exists('tmp/gone.bin')).toBe(false);
  });

  it('streams an object', async () => {
    await storage.put('s/stream.bin', Buffer.from('hello stream'), {
      contentType: 'application/octet-stream',
    });
    const stream = await storage.getStream('s/stream.bin');

    const chunks: Uint8Array[] = [];
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    expect(Buffer.concat(chunks).toString()).toBe('hello stream');
  });

  it('refuses any key that would escape the storage root', async () => {
    // Keys are server-generated, so these should be unreachable — this is the second
    // lock on the same door.
    const escapes = [
      '../outside.bin',
      '../../etc/passwd',
      'thumb/../../outside.bin',
      'a/b/../../../outside.bin',
    ];

    for (const key of escapes) {
      await expect(
        storage.put(key, Buffer.from('x'), { contentType: 'application/octet-stream' }),
        `put("${key}") must be refused`,
      ).rejects.toThrow(/escapes the root/);

      await expect(storage.get(key), `get("${key}") must be refused`).rejects.toThrow(
        /escapes the root/,
      );
      await expect(storage.delete(key), `delete("${key}") must be refused`).rejects.toThrow(
        /escapes the root/,
      );
    }
  });

  it('allows a key that merely contains dots without escaping', async () => {
    await storage.put('ok/file.name.with.dots.bin', Buffer.from('y'), {
      contentType: 'application/octet-stream',
    });
    expect(await storage.exists('ok/file.name.with.dots.bin')).toBe(true);
  });
});
