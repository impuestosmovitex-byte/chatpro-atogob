import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function config() {
  const apiBase = process.env.CHATPRO_API_URL?.trim().replace(/\/$/, '');
  const inboxKey = process.env.CHATPRO_INBOX_KEY?.trim();

  if (!apiBase || !inboxKey) {
    throw new Error('Faltan CHATPRO_API_URL o CHATPRO_INBOX_KEY en la web.');
  }

  return { apiBase, inboxKey };
}

export async function GET(request: NextRequest) {
  try {
    const company =
      request.nextUrl.searchParams.get('company')?.trim().toLowerCase() ?? '';

    if (!company) {
      return NextResponse.json(
        { ok: false, error: 'Falta la empresa.' },
        { status: 400 },
      );
    }

    const { apiBase, inboxKey } = config();
    const target = new URL(`${apiBase}/integrations`);
    target.searchParams.set('company', company);

    const response = await fetch(target, {
      headers: { 'x-chatpro-inbox-key': inboxKey },
      cache: 'no-store',
    });

    return new NextResponse(await response.text(), {
      status: response.status,
      headers: {
        'content-type': response.headers.get('content-type') ?? 'application/json',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'No se pudieron cargar las integraciones.',
      },
      { status: 500 },
    );
  }
}
