import { NextRequest, NextResponse } from 'next/server';
import {
  getInboxSession,
  INBOX_SESSION_COOKIE,
} from '../../lib/inbox-auth';

export const dynamic = 'force-dynamic';

function config() {
  const apiBase = process.env.CHATPRO_API_URL?.trim().replace(/\/$/, '');
  const inboxKey = process.env.CHATPRO_INBOX_KEY?.trim();

  if (!apiBase || !inboxKey) {
    throw new Error('Faltan CHATPRO_API_URL o CHATPRO_INBOX_KEY.');
  }

  return { apiBase, inboxKey };
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

  const roleKey = session.roleKey.trim().toLowerCase();

  if (roleKey !== 'owner' && roleKey !== 'admin') {
    return NextResponse.json(
      {
        ok: false,
        error: 'Solo propietarios y administradores pueden ver este panel.',
      },
      { status: 403 },
    );
  }

  try {
    const { apiBase, inboxKey } = config();
    const target = new URL(`${apiBase}/platform-health`);
    target.searchParams.set('company', session.companySlug);
    target.searchParams.set(
      'refresh',
      request.nextUrl.searchParams.get('refresh') === '0'
        ? 'false'
        : 'true',
    );

    const response = await fetch(target, {
      headers: {
        'x-chatpro-inbox-key': inboxKey,
      },
      cache: 'no-store',
    });
    const contentType =
      response.headers.get('content-type') ?? 'application/json';

    return new NextResponse(await response.arrayBuffer(), {
      status: response.status,
      headers: { 'content-type': contentType },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'No se pudo revisar la plataforma.',
      },
      { status: 500 },
    );
  }
}
