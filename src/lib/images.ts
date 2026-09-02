import { createHash } from 'node:crypto';
import sharp, { type Metadata } from 'sharp';

/**
 * Image ingestion: validation, metadata extraction and derivative generation.
 *
 * This module is the only place untrusted bytes are inspected, and it is the most
 * exposed surface in the archive — anyone who can upload reaches it.
 */

/**
 * Accepted formats, identified by magic bytes.
 *
 * The file extension and the browser-supplied Content-Type are both attacker
 * controlled and are never consulted. `holiday.jpg` claiming `image/jpeg` means
 * nothing; what the first bytes say is what the file is.
 */
const SIGNATURES: ReadonlyArray<{
  mime: string;
  ext: string;
  test: (b: Buffer) => boolean;
}> = [
  {
    mime: 'image/jpeg',
    ext: 'jpg',
    test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/png',
    ext: 'png',
    test: (b) =>
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  {
    mime: 'image/webp',
    ext: 'webp',
    // 'RIFF' .... 'WEBP'
    test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' &&
                 b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
  {
    mime: 'image/gif',
    ext: 'gif',
    test: (b) => b.subarray(0, 6).toString('latin1') === 'GIF87a' ||
                 b.subarray(0, 6).toString('latin1') === 'GIF89a',
  },
  {
    mime: 'image/tiff',
    ext: 'tif',
    test: (b) => (b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00) ||
                 (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a),
  },
  {
    mime: 'image/heic',
    ext: 'heic',
    // ISO-BMFF: size, 'ftyp', then a HEIF-family brand.
    test: (b) =>
      b.subarray(4, 8).toString('latin1') === 'ftyp' &&
      ['heic', 'heix', 'hevc', 'heim', 'heis', 'hevm', 'mif1', 'msf1'].includes(
        b.subarray(8, 12).toString('latin1'),
      ),
  },
];

/**
 * Decompression-bomb ceiling.
 *
 * A few kilobytes of PNG can describe a 50,000 × 50,000 image that expands to
 * ~10 GB once decoded, exhausting memory on the worker. 100 megapixels is far above
 * any real camera (a 100 MP phone photo is ~12000 × 8000) while making the classic
 * bomb fail at the decoder rather than in the allocator.
 */
export const MAX_PIXELS = 100_000_000;

/** Long edge of the grid thumbnail. */
export const THUMB_MAX = 400;

/** Long edge of the lightbox preview — the largest image any member ever receives. */
export const PREVIEW_MAX = 1600;

export type DetectedFormat = { mime: string; ext: string };

/** Identify a buffer by content, or return null if it is not an accepted image. */
export function detectFormat(buffer: Buffer): DetectedFormat | null {
  if (buffer.length < 12) return null;
  const match = SIGNATURES.find((s) => s.test(buffer));
  return match ? { mime: match.mime, ext: match.ext } : null;
}

export type ValidationFailure =
  | 'empty'
  | 'too_large'
  | 'unrecognised_format'
  | 'dimensions_unreadable'
  | 'too_many_pixels'
  | 'decode_failed';

export type ValidatedImage = {
  format: DetectedFormat;
  width: number;
  height: number;
  sha256: string;
  bytes: number;
  takenAt: Date | null;
};

/**
 * Validate an upload and extract the metadata worth keeping.
 *
 * Order matters: cheap checks first, so a hostile file is rejected before anything
 * expensive touches it.
 */
export async function validateImage(
  buffer: Buffer,
  maxBytes: number,
): Promise<{ ok: true; image: ValidatedImage } | { ok: false; reason: ValidationFailure }> {
  if (buffer.length === 0) return { ok: false, reason: 'empty' };
  if (buffer.length > maxBytes) return { ok: false, reason: 'too_large' };

  const format = detectFormat(buffer);
  if (!format) return { ok: false, reason: 'unrecognised_format' };

  try {
    const metadata = await sharp(buffer, { limitInputPixels: MAX_PIXELS }).metadata();

    const { width, height } = metadata;
    if (!width || !height) return { ok: false, reason: 'dimensions_unreadable' };
    if (width * height > MAX_PIXELS) return { ok: false, reason: 'too_many_pixels' };

    return {
      ok: true,
      image: {
        format,
        width,
        height,
        sha256: createHash('sha256').update(buffer).digest('hex'),
        bytes: buffer.length,
        takenAt: extractTakenAt(metadata),
      },
    };
  } catch {
    // sharp refusing to decode is a rejection, not a server error: a file it cannot
    // read is a file we will not store.
    return { ok: false, reason: 'decode_failed' };
  }
}

/**
 * Read the capture time from EXIF, so the timeline is ordered by when a photo was
 * taken rather than when someone got round to uploading it.
 *
 * Only the timestamp is lifted. GPS coordinates are deliberately *not* extracted:
 * an archive of a college batch should not quietly become a map of where its
 * members were. Location is a field members fill in themselves if they want to.
 */
function extractTakenAt(metadata: Metadata): Date | null {
  const raw = metadata.exif;
  if (!raw) return null;

  // EXIF dates are "YYYY:MM:DD HH:MM:SS". Scan the block rather than pulling in an
  // EXIF parser for one field.
  const match = raw
    .toString('latin1')
    .match(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!match) return null;

  const [, y, mo, d, h, mi, s] = match;
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);

  if (Number.isNaN(date.getTime())) return null;
  // A camera with a dead clock reports 1970 or 2035; neither belongs on the timeline.
  const year = date.getUTCFullYear();
  if (year < 1990 || date.getTime() > Date.now() + 86_400_000) return null;

  return date;
}

export type Derivative = { buffer: Buffer; width: number; height: number; bytes: number };

/**
 * Render the two derivatives every photo gets.
 *
 * Both are re-encoded from decoded pixels, which is what actually neutralises a
 * polyglot file: whatever HTML, script or archive was smuggled into the original's
 * trailing bytes or metadata does not survive being decoded to a pixel buffer and
 * written back out as WebP. These — never the original — are what members receive.
 *
 * `.rotate()` before resizing applies the EXIF orientation and then discards it.
 * Skipping it would leave every phone photo sideways, because sharp drops metadata
 * by default and the viewer would have no orientation flag left to honour.
 *
 * All other metadata is dropped with it: GPS coordinates, camera serial numbers,
 * owner names and software fingerprints never reach anyone's browser.
 */
export async function generateDerivatives(
  buffer: Buffer,
): Promise<{ thumb: Derivative; preview: Derivative }> {
  const source = sharp(buffer, { limitInputPixels: MAX_PIXELS }).rotate();

  const render = async (maxEdge: number, quality: number): Promise<Derivative> => {
    const output = await source
      .clone()
      .resize(maxEdge, maxEdge, {
        fit: 'inside', // preserve aspect ratio; never distort someone's photo
        withoutEnlargement: true, // a small original stays small rather than being upscaled
      })
      .webp({ quality })
      .toBuffer({ resolveWithObject: true });

    return {
      buffer: output.data,
      width: output.info.width,
      height: output.info.height,
      bytes: output.data.byteLength,
    };
  };

  const [thumb, preview] = await Promise.all([
    render(THUMB_MAX, 75),
    render(PREVIEW_MAX, 80),
  ]);

  return { thumb, preview };
}

export function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
