import { NextRequest, NextResponse } from 'next/server';
import { getInboxSession, INBOX_SESSION_COOKIE } from './inbox-auth';

type ProxyVerb = 'GET' | 'PATCH';

export async function proxyNativeCommerce(
  request: NextRequest,
  endpoint: string,
  method: ProxyVerb = 'GET',
  body?: unknown,
): Promise<NextResponse> {
  const session = await getInboxSession(
    request.cookies.get(INBOX_SESSION_COOKIE)?.value,
  );

  if (!session || session.type !== 'user' || !session.userId) {
    return NextResponse.json({ ok: false, error: 'Inicia sesión para consultar pedidos.' }, { status: 401 });
  }

  if (!['owner', 'admin'].includes(session.roleKey.toLowerCase())) {
    return NextResponse.json(
      { ok: false, error: 'Necesitas permisos de administración para este módulo.' },
      { status: 403 },
    );
  }

  const apiBase = process.env.CHATPRO_API_URL?.trim().replace(/\/$/, '');
  const inboxKey = process.env.CHATPRO_INBOX_KEY?.trim();
  if (!apiBase || !inboxKey) {
    return NextResponse.json(
      { ok: false, error: 'El entorno aún no tiene las credenciales internas configuradas.' },
      { status: 503 },
    );
  }

  try {
    const target = new URL(`${apiBase}/native-commerce/${endpoint}`);
    if (method === 'GET') {
      const status = request.nextUrl.searchParams.get('status');
      if (status && endpoint === 'orders') target.searchParams.set('status', status);
    }

    const response = await fetch(target, {
      method,
      headers: {
        'x-chatpro-inbox-key': inboxKey,
        'x-chatpro-company-id': session.companyId,
        'x-chatpro-user-id': session.userId,
        ...(method !== 'GET' ? { 'content-type': 'application/json' } : {}),
      },
      ...(method !== 'GET' ? { body: JSON.stringify(body ?? {}) } : {}),
      cache: 'no-store',
    });

    const contentType = response.headers.get('content-type') ?? 'application/json';
    const responseBody = await response.text();
    return new NextResponse(responseBody, {
      status: response.status,
      headers: { 'content-type': contentType, 'cache-control': 'no-store' },
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: 'No se pudo conectar al servicio de pedidos.' },
      { status: 503 },
    );
  }
}
