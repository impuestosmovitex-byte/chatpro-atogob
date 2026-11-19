import { spawnSync } from 'node:child_process';
import { accessSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { identifyImage, MAX_WHATSAPP_IMAGE_BYTES, normalizeWhatsappImage } from './whatsapp-image-normalizer';

const ffmpeg = require('ffmpeg-static') as string | null;

function fixture(format: string, pixelFormat: string, width = 320, height = 200): Buffer {
  if (!ffmpeg) throw new Error('ffmpeg-static is required for image tests');
  const dir = mkdtempSync(join(tmpdir(), 'mw1-image-fixture-'));
  try {
    const target = join(dir, 'test.' + format);
    const result = spawnSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
      `testsrc2=size=${width}x${height}:rate=1`, '-frames:v', '1',
      '-pix_fmt', pixelFormat, '-y', target,
    ], { timeout: 15000 });
    if (result.status !== 0) throw new Error(result.stderr.toString());
    return readFileSync(target);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe('WhatsApp image normalization (offline; never calls Meta)', () => {
  beforeAll(() => { if (!ffmpeg) throw new Error('ffmpeg-static missing'); accessSync(ffmpeg); });
  it.each([
    ['JPEG', 'jpg', 'yuvj420p'],
    ['PNG', 'png', 'rgb24'],
    ['WEBP', 'webp', 'yuv420p'],
    ['16-bit PNG', 'png', 'rgb48be'],
    ['GIF', 'gif', 'rgb8'],
    ['BMP', 'bmp', 'rgb24'],
  ])('converts %s to real 8-bit JPEG under 5 MB', async (_label, ext, pixel) => {
    const source = fixture(ext, pixel);
    const normalized = await normalizeWhatsappImage(source);
    expect(normalized.mimeType).toBe('image/jpeg');
    expect(normalized.filename.endsWith('.jpg')).toBe(true);
    expect(identifyImage(normalized.buffer)).toBe('jpeg');
    expect(normalized.buffer.length).toBeLessThan(MAX_WHATSAPP_IMAGE_BYTES);
    const result = spawnSync(ffmpeg!, [
      '-v', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-i', 'pipe:0',
      '-frames:v', '1', '-f', 'null', '-',
    ], { input: normalized.buffer, timeout: 15000 });
    expect(result.status).toBe(0);
  }, 60000);

  it('converts a real CMYK JPEG (Adobe APP14) to compatible JPEG', async () => {
    const cmyk = Buffer.from('/9j/7gAOQWRvYmUAZAAAAAAA/9sAQwAIBgYHBgUIBwcHCQkICgwUDQwLCwwZEhMPFB0aHx4dGhwcICQuJyAiLCMcHCg3KSwwMTQ0NB8nOT04MjwuMzQy/8AAFAgAIAAgBEMRAE0RAFkRAEsRAP/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/aAA4EQwBNAFkASwAAPwD3+krwSvf6KKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKK/9k=', 'base64');
    const normalized = await normalizeWhatsappImage(cmyk);
    expect(identifyImage(normalized.buffer)).toBe('jpeg');
    expect(normalized.buffer.length).toBeLessThan(MAX_WHATSAPP_IMAGE_BYTES);
  });

  it('rejects fake MIME/invalid bytes without uploading', async () => {
    await expect(normalizeWhatsappImage(Buffer.from('%PDF-1.4 not an image'))).rejects.toThrow('no contiene una imagen');
    await expect(normalizeWhatsappImage(Buffer.alloc(0))).rejects.toThrow('vacía');
    await expect(normalizeWhatsappImage(Buffer.from([0xff, 0xd8, 0xff, 0, 0]))).rejects.toThrow();
  });

  it('rejects an oversized original before invoking the decoder', async () => {
    await expect(normalizeWhatsappImage(Buffer.alloc(25 * 1024 * 1024 + 1, 1))).rejects.toThrow('25 MB');
  });
});
