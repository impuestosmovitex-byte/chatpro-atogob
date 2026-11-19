import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const MAX_WHATSAPP_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_INPUT_BYTES = 25 * 1024 * 1024;

type PreparedImage = { buffer: Buffer; mimeType: 'image/jpeg'; filename: string };

export function identifyImage(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6))) return 'gif';
  if (buffer.length >= 2 && buffer.toString('ascii', 0, 2) === 'BM') return 'bmp';
  if (buffer.length >= 4 && (buffer.subarray(0,4).equals(Buffer.from([0x49,0x49,0x2a,0])) || buffer.subarray(0,4).equals(Buffer.from([0x4d,0x4d,0,0x2a])))) return 'tiff';
  return null;
}

/** All uploaded images are decoded and re-encoded. Never trust the client MIME/extension. */
export async function normalizeWhatsappImage(buffer: Buffer): Promise<PreparedImage> {
  if (!buffer.length) throw new Error('La imagen está vacía.');
  if (buffer.length > MAX_IMAGE_INPUT_BYTES) throw new Error('La imagen original supera 25 MB. Selecciona una fotografía más pequeña.');
  const format = identifyImage(buffer);
  if (!format) throw new Error('El archivo no contiene una imagen compatible. Usa JPG, PNG, WEBP, GIF, BMP o TIFF.');

  const ffmpegPath = require('ffmpeg-static') as string | null;
  if (!ffmpegPath) throw new Error('El conversor de imágenes no está instalado.');
  try { await access(ffmpegPath); } catch { throw new Error('El conversor de imágenes no está disponible en el servidor.'); }

  const directory = await mkdtemp(join(tmpdir(), 'mw1-whatsapp-image-'));
  const inputPath = join(directory, 'input.' + format);
  try {
    await writeFile(inputPath, buffer);
    // JPEG is always 8-bit baseline-compatible YCbCr, not CMYK, WEBP or 16-bit PNG.
    // ffmpeg autorotates using EXIF by default; scale preserves aspect ratio.
    for (const width of [2400, 2000, 1600, 1200]) {
      for (const quality of [2, 4, 7, 11, 16]) {
        const outputPath = join(directory, 'output.jpg');
        const args = [
          '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
          '-i', inputPath, '-frames:v', '1',
          '-vf', `scale=w='min(${width},iw)':h='min(${width},ih)':force_original_aspect_ratio=decrease:flags=lanczos,format=yuvj420p`,
          '-c:v', 'mjpeg', '-pix_fmt', 'yuvj420p', '-q:v', String(quality),
          '-map_metadata', '-1', outputPath,
        ];
        await runConverter(ffmpegPath, args);
        const converted = await readFile(outputPath);
        if (identifyImage(converted) !== 'jpeg') throw new Error('La conversión no produjo un JPEG válido.');
        if (converted.length > 0 && converted.length < MAX_WHATSAPP_IMAGE_BYTES) {
          return { buffer: converted, mimeType: 'image/jpeg', filename: 'imagen-whatsapp.jpg' };
        }
      }
    }
    throw new Error('No se pudo reducir la imagen por debajo de 5 MB sin perder demasiada calidad.');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function runConverter(executable: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let errorText = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
    child.stderr.on('data', (data: Buffer) => { errorText += data.toString('utf8').slice(0, 800); });
    child.once('error', (error) => { clearTimeout(timer); reject(new Error('No se pudo convertir la imagen: ' + error.message)); });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error('La imagen está dañada o no se pudo procesar. Prueba otra foto. ' + errorText.trim().slice(0, 180)));
    });
  });
}
