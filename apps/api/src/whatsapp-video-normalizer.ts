import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const META_VIDEO_LIMIT = 16 * 1024 * 1024;
const INPUT_LIMIT = 35 * 1024 * 1024;

export type PreparedWhatsappVideo = {
  buffer: Buffer;
  mimeType: 'video/mp4';
  filename: 'video.mp4';
};

function isMovieContainer(buffer: Buffer): boolean {
  if (buffer.length < 16 || buffer.toString('ascii', 4, 8) !== 'ftyp') return false;
  const brand = buffer.toString('ascii', 8, 12);
  return /^[\\x20-\\x7e]{4}$/.test(brand);
}

function convert(source: string, destination: string, size: 'large' | 'small'): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const ffmpegPath = require('ffmpeg-static') as string | null;
    if (!ffmpegPath) {
      reject(new Error('No está disponible el conversor de video.'));
      return;
    }

    const dims = size === 'large' ? '1280:720' : '854:480';
    const crf = size === 'large' ? '30' : '37';
    const args = [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-i', source, '-map', '0:v:0', '-map', '0:a:0?',
      '-vf', `scale=${dims}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', crf,
      '-pix_fmt', 'yuv420p', '-profile:v', 'baseline',
      '-c:a', 'aac', '-b:a', '64k', '-ac', '1', '-ar', '44100',
      '-movflags', '+faststart', '-max_muxing_queue_size', '1024',
      '-f', 'mp4', destination,
    ];

    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let finished = false;
    const fail = (message: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      reject(new Error(message));
    };
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      fail('El video tarda demasiado en convertirse. Envíalo más corto o comprimido.');
    }, 55_000);
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 1200) stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => fail(`No se pudo convertir el video: ${error.message}`));
    child.on('close', (code) => {
      if (finished) return;
      if (code !== 0) {
        fail(`Video incompatible: ${stderr.trim().slice(0, 450) || 'falló la conversión'}`);
        return;
      }
      finished = true;
      clearTimeout(timeout);
      resolve();
    });
  });
}

/** Decode and re-encode untrusted video as H264/AAC MP4 for WhatsApp Cloud API. */
export async function normalizeWhatsappVideo(buffer: Buffer): Promise<PreparedWhatsappVideo> {
  if (!buffer?.length || !isMovieContainer(buffer)) {
    throw new Error('Archivo de video inválido. Usa MP4, MOV o 3GP.');
  }
  if (buffer.length > INPUT_LIMIT) {
    throw new Error('El video original supera 35 MB. Comprímelo antes de enviarlo.');
  }
  const ffmpegPath = require('ffmpeg-static') as string | null;
  if (!ffmpegPath) throw new Error('El conversor de video no está instalado.');
  await access(ffmpegPath);

  const directory = await mkdtemp(join(tmpdir(), 'mw1-video-'));
  try {
    const source = join(directory, 'input.mov');
    await writeFile(source, buffer);
    for (const size of ['large', 'small'] as const) {
      const destination = join(directory, `video-${size}.mp4`);
      await convert(source, destination, size);
      const result = await readFile(destination);
      if (result.length > 0 && result.length <= META_VIDEO_LIMIT && isMovieContainer(result)) {
        return { buffer: result, mimeType: 'video/mp4', filename: 'video.mp4' };
      }
    }
    throw new Error('El video convertido supera los 16 MB de WhatsApp. Reduce su duración.');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
