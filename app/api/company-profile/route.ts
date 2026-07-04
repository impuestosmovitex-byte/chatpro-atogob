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

function companyFrom(request: NextRequest) {
  return request.nextUrl.searchParams.get('company')?.trim().toLowerCase() ?? '';
}

async function proxyResponse(response: Response) {
  const contentType = response.headers.get('content-type') ?? 'application/json';
  const body = await response.text();

  return new NextResponse(body, {
    status: response.status,
    headers: { 'content-type': contentType },
  });
}

export async function GET(request: NextRequest) {
  try {
    const company = companyFrom(request);

    if (!company) {
      return NextResponse.json(
        { ok: false, error: 'Falta la empresa.' },
        { status: 400 },
      );
    }

    const { apiBase, inboxKey } = config();
    const target = new URL(`${apiBase}/company-profile`);
    target.searchParams.set('company', company);

    return proxyResponse(
      await fetch(target, {
        headers: { 'x-chatpro-inbox-key': inboxKey },
        cache: 'no-store',
      }),
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'No se pudo cargar la identidad de la empresa.',
      },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const company = companyFrom(request);

    if (!company) {
      return NextResponse.json(
        { ok: false, error: 'Falta la empresa.' },
        { status: 400 },
      );
    }

    const body = await request.json();
    const { apiBase, inboxKey } = config();
    const target = new URL(`${apiBase}/company-profile`);
    target.searchParams.set('company', company);

    return proxyResponse(
      await fetch(target, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'x-chatpro-inbox-key': inboxKey,
        },
        body: JSON.stringify(body),
        cache: 'no-store',
      }),
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'No se pudo guardar la identidad de la empresa.',
      },
      { status: 500 },
    );
  }
}
