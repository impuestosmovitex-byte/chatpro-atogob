import { NextRequest, NextResponse } from 'next/server';
import {
  createInboxSessionToken,
  getInboxSession,
  INBOX_SESSION_COOKIE,
  INBOX_SESSION_MAX_AGE_SECONDS,
  type ChatProSession,
} from '../../../lib/inbox-auth';

export const dynamic = 'force-dynamic';

type SwitchResponse = {
  ok?: boolean;
  error?: string;
  session?: Omit<ChatProSession, 'expiresAt'>;
};

function config() {
  const apiBase = process.env.CHATPRO_API_URL?.trim().replace(/\/$/, '');
  const inboxKey = process.env.CHATPRO_INBOX_KEY?.trim();

  if (!apiBase || !inboxKey) {
    throw new Error('Faltan CHATPRO_API_URL o CHATPRO_INBOX_KEY.');
  }

  return { apiBase, inboxKey };
}

export async function POST(request: NextRequest) {
  try {
    const current = await getInboxSession(
      request.cookies.get(INBOX_SESSION_COOKIE)?.value,
    );

    if (!current?.userId || current.type !== 'user') {
      return NextResponse.json(
        { ok: false, error: 'Sesión de usuario requerida.' },
        { status: 401 },
      );
    }

    const body = (await request.json()) as { companySlug?: unknown };
    const companySlug =
      typeof body.companySlug === 'string'
        ? body.companySlug.trim().toLowerCase()
        : '';

    if (!companySlug) {
      return NextResponse.json(
        { ok: false, error: 'Selecciona una empresa.' },
        { status: 400 },
      );
    }

    const { apiBase, inboxKey } = config();
    const response = await fetch(`${apiBase}/access/switch-company`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-chatpro-inbox-key': inboxKey,
      },
      body: JSON.stringify({
        userId: current.userId,
        companySlug,
      }),
      cache: 'no-store',
    });

    const data = (await response.json()) as SwitchResponse;

    if (!response.ok || !data.ok || !data.session) {
      return NextResponse.json(
        { ok: false, error: data.error || 'No se pudo cambiar de empresa.' },
        { status: response.status || 400 },
      );
    }

    const token = await createInboxSessionToken(data.session);
    const result = NextResponse.json({ ok: true, session: data.session });

    result.cookies.set({
      name: INBOX_SESSION_COOKIE,
      value: token,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: INBOX_SESSION_MAX_AGE_SECONDS,
    });

    return result;
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'No se pudo cambiar de empresa.',
      },
      { status: 500 },
    );
  }
}
