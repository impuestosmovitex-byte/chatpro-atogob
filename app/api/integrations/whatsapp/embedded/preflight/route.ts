import { NextRequest, NextResponse } from 'next/server';
import { getInboxSession, INBOX_SESSION_COOKIE } from '../../../../../lib/inbox-auth';

export const dynamic = 'force-dynamic';

/** Read-only check before any Meta subscription. The API performs tenant authorization. */
export async function POST(request: NextRequest) {
  const session = await getInboxSession(request.cookies.get(INBOX_SESSION_COOKIE)?.value);
  if (!session || session.type !== 'user' || !session.userId)
    return NextResponse.json({ ok: false, error: 'Inicia sesión como administrador de empresa.' }, { status: 401 });
  if (!['owner', 'admin'].includes(session.roleKey.trim().toLowerCase()))
    return NextResponse.json({ ok: false, error: 'No tienes permiso para administrar integraciones.' }, { status: 403 });

  const apiBase = process.env.CHATPRO_API_URL?.trim().replace(/\/$/, '');
  const inboxKey = process.env.CHATPRO_INBOX_KEY?.trim();
  if (!apiBase || !inboxKey)
    return NextResponse.json({ ok: false, error: 'Configuración de API incompleta.' }, { status: 503 });

  let body: { phoneNumberId?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Solicitud JSON inválida.' }, { status: 400 }); }
  if (typeof body?.phoneNumberId !== 'string' || !/^\d{6,30}$/.test(body.phoneNumberId))
    return NextResponse.json({ ok: false, error: 'Identificador de teléfono inválido.' }, { status: 400 });

  const target = new URL(`${apiBase}/integrations/whatsapp/embedded/preflight`);
  target.searchParams.set('company', session.companySlug);
  try {
    const response = await fetch(target, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-chatpro-inbox-key': inboxKey,
        'x-chatpro-user-id': session.userId,
        'x-chatpro-company-id': session.companyId,
      },
      body: JSON.stringify({ phoneNumberId: body.phoneNumberId }),
      cache: 'no-store',
    });
    return new NextResponse(await response.text(), {
      status: response.status,
      headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' },
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'La verificación de WhatsApp no está disponible.' }, { status: 502 });
  }
}
