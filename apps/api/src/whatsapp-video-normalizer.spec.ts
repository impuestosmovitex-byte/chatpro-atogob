import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeWhatsappVideo } from './whatsapp-video-normalizer';

describe('WhatsApp video normalization — offline, never calls Meta', () => {
  it('converts an MP4 to compatible H264/AAC within the 16 MB limit', async () => {
    const ffmpeg = require('ffmpeg-static') as string;
    const directory = mkdtempSync(join(tmpdir(), 'mw1-video-test-'));
    try {
      const path = join(directory, 'input.mp4');
      const result = spawnSync(ffmpeg, [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=1:r=8',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', path,
      ], { timeout: 20000 });
      expect(result.status).toBe(0);
      const converted = await normalizeWhatsappVideo(readFileSync(path));
      expect(converted.mimeType).toBe('video/mp4');
      expect(converted.buffer.subarray(4, 8).toString('ascii')).toBe('ftyp');
      expect(converted.buffer.length).toBeLessThan(16 * 1024 * 1024);
      expect(converted.filename).toBe('video.mp4');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 40000);

  it('rejects fake MP4 data before invoking ffmpeg', async () => {
    await expect(normalizeWhatsappVideo(Buffer.from('not a real MP4'))).rejects.toThrow('inválido');
  });

  it('rejects source video above 35 MB without uploading', async () => {
    const original = Buffer.alloc(35 * 1024 * 1024 + 1);
    original.write('ftyp', 4, 'ascii');
    original.write('isom', 8, 'ascii');
    await expect(normalizeWhatsappVideo(original)).rejects.toThrow('35 MB');
  });
});
