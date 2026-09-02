import type { PutOptions, StorageAdapter, StorageObject } from './types';

export type GDriveConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  folderId: string;
};

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const FILES_URL = 'https://www.googleapis.com/drive/v3/files';

/**
 * Google Drive, for cold storage of originals.
 *
 * Written against the REST API with `fetch` rather than the `googleapis` package,
 * which pulls in a very large dependency tree to do what amounts to four HTTP calls.
 *
 * WHY THIS IS ONLY FOR ORIGINALS — the limits are real and were the reason for the
 * hot/cold split:
 *
 *  - Sustained writes cap at roughly 3 requests/second per account. Ingesting
 *    100,000 files takes 9+ hours no matter how the client is written, so uploads
 *    here run on a throttled background queue and never block a member's upload.
 *  - There is no CDN. Every read is a full round trip to Google, which would be
 *    unusable for a gallery grid pulling dozens of thumbnails per scroll.
 *  - A shared drive holds at most 500,000 items.
 *  - Consumer Google One has no shared drives at all, and a service account cannot
 *    own Drive files, so this must authenticate as a real user via a refresh token.
 *    That token breaks on password change, 2FA change, or periodic re-consent —
 *    which is an availability risk for originals, and the reason a second copy
 *    elsewhere is worth having.
 *
 * None of that matters for originals, because members never download them: only
 * admins do, rarely, and with an audit record.
 */
export class GDriveStorage implements StorageAdapter {
  readonly name = 'gdrive';

  private accessToken: string | null = null;
  private expiresAt = 0;

  constructor(private readonly config: GDriveConfig) {}

  /**
   * Exchange the long-lived refresh token for an access token, cached until shortly
   * before it expires. The 60-second margin avoids losing a request to a token that
   * expires in flight.
   */
  private async token(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt - 60_000) {
      return this.accessToken;
    }

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: this.config.refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      // Deliberately does not echo the response body — it can contain token material.
      throw new Error(
        `Google Drive token refresh failed (${response.status}). ` +
          'The refresh token may have been revoked by a password or 2FA change.',
      );
    }

    const data = (await response.json()) as { access_token: string; expires_in: number };
    this.accessToken = data.access_token;
    this.expiresAt = Date.now() + data.expires_in * 1000;
    return this.accessToken;
  }

  private async authed(url: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.token();
    return fetch(url, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${token}` },
    });
  }

  /**
   * Upload via Drive's multipart endpoint.
   *
   * Returns the Drive file id as the storage key — Drive addresses files by an id it
   * assigns, not by a path we choose, so the caller persists what comes back. Our
   * generated key is kept as the file's `name` so the folder stays legible to a
   * human looking at it directly.
   */
  async put(key: string, body: Buffer | Uint8Array, options: PutOptions): Promise<StorageObject> {
    const boundary = `boundary-${crypto.randomUUID()}`;
    const metadata = JSON.stringify({
      name: key.replace(/\//g, '_'),
      parents: [this.config.folderId],
    });

    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
          `--${boundary}\r\ncontent-type: ${options.contentType}\r\n\r\n`,
      ),
      Buffer.from(body),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const response = await this.authed(`${UPLOAD_URL}?uploadType=multipart&fields=id,size`, {
      method: 'POST',
      headers: { 'content-type': `multipart/related; boundary=${boundary}` },
      body: new Uint8Array(payload),
    });

    if (!response.ok) {
      throw new Error(`Google Drive upload failed (${response.status}) for ${key}`);
    }

    const file = (await response.json()) as { id: string };
    return { key: file.id, bytes: body.byteLength, contentType: options.contentType };
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.authed(`${FILES_URL}/${encodeURIComponent(key)}?alt=media`);
    if (!response.ok) throw new Error(`Google Drive download failed (${response.status})`);
    return Buffer.from(await response.arrayBuffer());
  }

  async getStream(key: string): Promise<ReadableStream<Uint8Array>> {
    const response = await this.authed(`${FILES_URL}/${encodeURIComponent(key)}?alt=media`);
    if (!response.ok || !response.body) {
      throw new Error(`Google Drive download failed (${response.status})`);
    }
    return response.body;
  }

  async exists(key: string): Promise<boolean> {
    return (await this.size(key)) !== null;
  }

  async delete(key: string): Promise<void> {
    const response = await this.authed(`${FILES_URL}/${encodeURIComponent(key)}`, {
      method: 'DELETE',
    });
    // 404 means it is already gone, which satisfies the caller's intent.
    if (!response.ok && response.status !== 404) {
      throw new Error(`Google Drive delete failed (${response.status})`);
    }
  }

  async size(key: string): Promise<number | null> {
    const response = await this.authed(`${FILES_URL}/${encodeURIComponent(key)}?fields=size`);
    if (!response.ok) return null;
    const data = (await response.json()) as { size?: string };
    return data.size ? Number(data.size) : null;
  }
}
