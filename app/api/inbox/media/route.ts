import { spawn } from 'node:child_process';
import { NextRequest, NextResponse } from 'next/server';
import {
  INBOX_SESSION_COOKIE,
  getInboxSession,
} from '../../../lib/inbox-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function config() {
  const apiBase = process.env.CHATPRO_API_URL?.trim().replace(/\/$/, '');
  const inboxKey = process.env.CHATPRO_INBOX_KEY?.trim();

  if (!apiBase || !inboxKey) {
    throw new Error('Faltan CHATPRO_API_URL o CHATPRO_INBOX_KEY.');
  }

  return { apiBase, inboxKey };
}

function trustedHeaders(
  inboxKey: string,
  session: NonNullable<Awaited<ReturnType<typeof getInboxSession>>>,
) {
  const headers: Record<string, string> = {
    'x-chatpro-inbox-key': inboxKey,
    'x-chatpro-session-type': session.type,
    'x-chatpro-user-name': session.fullName,
    'x-chatpro-company-id': session.companyId,
    'x-chatpro-role-key': session.roleKey,
  };

  if (session.type === 'user' && session.userId) {
    headers['x-chatpro-user-id'] = session.userId;
  }

  return headers;
}

function cleanMimeType(value: string | null) {
  return (value || 'application/octet-stream')
    .split(';')[0]
    .trim()
    .toLowerCase();
}

function shouldNormalizeAudio(mimeType: string) {
  if (!mimeType.startsWith('audio/')) return false;

  return ![
    'audio/mpeg',
    'audio/mp3',
    'audio/mp4',
    'audio/x-m4a',
    'audio/aac',
    'audio/wav',
    'audio/x-wav',
  ].includes(mimeType);
}

async function transcodeAudioToMp3(input: Buffer): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const ffmpeg = spawn(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        'pipe:0',
        '-vn',
        '-ac',
        '1',
        '-ar',
        '44100',
        '-codec:a',
        'libmp3lame',
        '-b:a',
        '96k',
        '-f',
        'mp3',
        'pipe:1',
      ],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    let settled = false;

    const finishWithError = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const timeout = setTimeout(() => {
      ffmpeg.kill('SIGKILL');
      finishWithError(new Error('La conversión del audio excedió el tiempo permitido.'));
    }, 20_000);

    ffmpeg.stdout.on('data', (chunk: Buffer) => {
      output.push(Buffer.from(chunk));
    });

    ffmpeg.stderr.on('data', (chunk: Buffer) => {
      errors.push(Buffer.from(chunk));
    });

    ffmpeg.on('error', (error) => {
      clearTimeout(timeout);
      finishWithError(error);
    });

    ffmpeg.on('close', (code) => {
      clearTimeout(timeout);

      if (settled) return;

      if (code !== 0) {
        finishWithError(
          new Error(
            Buffer.concat(errors).toString('utf8').trim() ||
              `FFmpeg terminó con código ${code}.`,
          ),
        );
        return;
      }

      const result = Buffer.concat(output);

      if (!result.length) {
        finishWithError(new Error('La conversión del audio produjo un archivo vacío.'));
        return;
      }

      settled = true;
      resolve(result);
    });

    ffmpeg.stdin.on('error', () => {
      // FFmpeg puede cerrar stdin al terminar; el evento close resolverá el proceso.
    });

    ffmpeg.stdin.end(input);
  });
}

export async function GET(request: NextRequest) {
  const session = await getInboxSession(
    request.cookies.get(INBOX_SESSION_COOKIE)?.value,
  );

  if (!session) {
    return NextResponse.json(
      { ok: false, error: 'Sesión requerida.' },
      { status: 401 },
    );
  }

  try {
    const sessionId =
      request.nextUrl.searchParams.get('sessionId')?.trim() ?? '';
    const messageId =
      request.nextUrl.searchParams.get('messageId')?.trim() ?? '';

    if (!sessionId || !messageId) {
      return NextResponse.json(
        { ok: false, error: 'Falta identificar el archivo.' },
        { status: 400 },
      );
    }

    const { apiBase, inboxKey } = config();
    const target = new URL(
      `${apiBase}/inbox/${encodeURIComponent(
        sessionId,
      )}/messages/${encodeURIComponent(messageId)}/media`,
    );
    target.searchParams.set('company', session.companySlug);

    const response = await fetch(target, {
      headers: {
        ...trustedHeaders(inboxKey, session),
        accept: 'image/*,audio/*,video/*,application/pdf,application/octet-stream',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      const raw = await response.text();
      let detail = raw || 'No se pudo cargar el archivo.';

      try {
        const parsed = JSON.parse(raw) as {
          error?: unknown;
          message?: unknown;
        };

        detail =
          typeof parsed.error === 'string'
            ? parsed.error
            : typeof parsed.message === 'string'
              ? parsed.message
              : detail;
      } catch {
        // El detalle ya contiene la respuesta original.
      }

      return NextResponse.json(
        { ok: false, error: detail },
        { status: response.status },
      );
    }

    const originalMimeType = cleanMimeType(
      response.headers.get('content-type'),
    );
    const originalBody = Buffer.from(await response.arrayBuffer());

    if (shouldNormalizeAudio(originalMimeType)) {
      try {
        const normalizedAudio = await transcodeAudioToMp3(originalBody);

        return new NextResponse(new Uint8Array(normalizedAudio), {
          status: 200,
          headers: {
            'content-type': 'audio/mpeg',
            'content-length': String(normalizedAudio.length),
            'content-disposition': 'inline; filename="audio.mp3"',
            'cache-control': 'private, max-age=3600',
            'accept-ranges': 'none',
            'x-chatpro-audio-normalized': 'mp3',
          },
        });
      } catch (error) {
        console.error(
          '[ChatPro][media] No se pudo normalizar audio para reproducción móvil:',
          error,
        );
      }
    }

    return new NextResponse(new Uint8Array(originalBody), {
      status: 200,
      headers: {
        'content-type':
          response.headers.get('content-type') ?? 'application/octet-stream',
        'content-length': String(originalBody.length),
        'content-disposition':
          response.headers.get('content-disposition') ??
          'inline; filename="archivo"',
        'cache-control': 'private, max-age=3600',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'No se pudo cargar el archivo.',
      },
      { status: 500 },
    );
  }
}
