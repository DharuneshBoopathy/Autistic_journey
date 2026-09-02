/**
 * Storage abstraction.
 *
 * The archive splits storage by access pattern rather than by vendor:
 *
 *   derivatives (thumbnails, previews) — small, hot, regenerable
 *   originals                          — large, cold, irreplaceable
 *
 * Members never download originals; only admins can. That makes originals genuinely
 * cold, so they can sit on cheap slow storage while the gallery serves derivatives
 * from something fast. This interface is what lets those two live in different
 * places, and lets either be moved without touching application code.
 *
 * Nothing here is public. There is no `getPublicUrl`, deliberately: every byte is
 * served through an authorization-checked route, so a public URL would be a way to
 * bypass the check and must not be expressible.
 */

export type StorageObject = {
  key: string;
  bytes: number;
  contentType: string;
};

export type PutOptions = {
  contentType: string;
  /**
   * Advisory only. Never trust it for security decisions — the content type of a
   * stored object is whatever the bytes actually are, which is why the upload
   * pipeline sniffs magic bytes and re-encodes rather than believing this.
   */
  cacheControl?: string;
};

export interface StorageAdapter {
  /** Human-readable driver name, persisted alongside each key so objects stay locatable after a migration. */
  readonly name: string;

  /**
   * Store an object and return the key to persist.
   *
   * The returned key may differ from the one passed in: Google Drive addresses files
   * by an id it assigns at creation, not by a path we choose. Callers must therefore
   * record `result.key`, never the key they supplied — the object-store drivers
   * return it unchanged, so this costs nothing and keeps Drive from being a special
   * case throughout the codebase.
   */
  put(key: string, body: Buffer | Uint8Array, options: PutOptions): Promise<StorageObject>;

  get(key: string): Promise<Buffer>;

  /** Streamed read, for serving large originals without buffering them in memory. */
  getStream(key: string): Promise<ReadableStream<Uint8Array>>;

  exists(key: string): Promise<boolean>;

  delete(key: string): Promise<void>;

  /** Best-effort byte size, or null when the object is absent. */
  size(key: string): Promise<number | null>;
}

/**
 * Storage keys are generated here and only here.
 *
 * They are built from a UUID the server chose, never from a user-supplied filename.
 * That is what makes path traversal (`../../etc/passwd`) structurally impossible
 * rather than something a sanitiser has to catch — the untrusted string never
 * reaches the path at all. The original filename is kept in the database as
 * metadata, for display and search.
 *
 * The two-level fan-out (`ab/cd/`) keeps any single directory or listing prefix
 * manageable at 100k+ objects.
 */
export function buildKey(
  kind: 'original' | 'thumb' | 'preview' | 'quarantine',
  photoId: string,
  extension: string,
): string {
  const clean = photoId.replace(/-/g, '');
  const a = clean.slice(0, 2);
  const b = clean.slice(2, 4);
  const ext = extension.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return `${kind}/${a}/${b}/${clean}.${ext}`;
}
