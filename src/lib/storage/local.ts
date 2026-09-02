import { createReadStream } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { PutOptions, StorageAdapter, StorageObject } from './types';

/**
 * Local-disk driver, for development and tests.
 *
 * Not durable and not suitable for production — `env.ts` refuses to boot a
 * production server configured with it.
 */
export class LocalStorage implements StorageAdapter {
  readonly name = 'local';

  constructor(private readonly root: string) {}

  /**
   * Resolve a key to an absolute path, refusing anything that escapes the root.
   *
   * Keys are server-generated (see `buildKey`), so a traversal attempt should be
   * impossible upstream. This is the second lock on the same door: if a key ever
   * reaches here carrying `../`, it is rejected rather than quietly writing outside
   * the archive.
   */
  private resolve(key: string): string {
    const root = path.resolve(this.root);
    const full = path.resolve(root, key);

    if (full !== root && !full.startsWith(root + path.sep)) {
      throw new Error(`Refusing storage key that escapes the root: ${key}`);
    }
    return full;
  }

  async put(key: string, body: Buffer | Uint8Array, options: PutOptions): Promise<StorageObject> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body);
    return { key, bytes: body.byteLength, contentType: options.contentType };
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async getStream(key: string): Promise<ReadableStream<Uint8Array>> {
    const nodeStream = createReadStream(this.resolve(key));
    return Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
  }

  async exists(key: string): Promise<boolean> {
    return (await this.size(key)) !== null;
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async size(key: string): Promise<number | null> {
    try {
      return (await stat(this.resolve(key))).size;
    } catch {
      return null;
    }
  }
}
