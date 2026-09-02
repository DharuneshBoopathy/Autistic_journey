import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { PutOptions, StorageAdapter, StorageObject } from './types';

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

/**
 * Cloudflare R2, via the S3-compatible API.
 *
 * The bucket must have public access disabled. Nothing in this class produces a
 * publicly fetchable URL, and the interface has no method that could — every byte
 * reaches a viewer through the app's authorization-checked route, so that the check
 * cannot be routed around.
 *
 * R2 charges nothing for egress, which is why derivatives live here: a gallery
 * serves a great many small images, and egress is the cost that would otherwise
 * dominate.
 */
export class R2Storage implements StorageAdapter {
  readonly name = 'r2';
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: R2Config) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async put(key: string, body: Buffer | Uint8Array, options: PutOptions): Promise<StorageObject> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: options.contentType,
        CacheControl: options.cacheControl,
      }),
    );
    return { key, bytes: body.byteLength, contentType: options.contentType };
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const bytes = await response.Body!.transformToByteArray();
    return Buffer.from(bytes);
  }

  async getStream(key: string): Promise<ReadableStream<Uint8Array>> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return response.Body!.transformToWebStream();
  }

  async exists(key: string): Promise<boolean> {
    return (await this.size(key)) !== null;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async size(key: string): Promise<number | null> {
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return head.ContentLength ?? null;
    } catch {
      return null;
    }
  }
}
