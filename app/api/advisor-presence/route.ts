import { NextRequest, NextResponse } from 'next/server';
import { getInboxSession, INBOX_SESSION_COOKIE } from '../../lib/inbox-auth';

export const dynamic = 'force-dynamic';

function config() {
  const apiBase = process.env.CHATPRO_API_URL?.trim().replace(/\/$/, '');
  const inboxKey = process.env.CHATPRO_INBOX_KEY?.trim();
  if (!apiBase || !inboxKey) throw new Error('Faltan CHATPRO_API_URL o CHATPRO_INBOX_KEY.');
  return { apiBase, inboxKey };
}

async function sessionFor(request: NextRequest) {
  const session = await getInboxSession(request.cookies.get(INBOX_SESSION_COOKIE)?.value);
  return session?.type === 'user' && session.userId ? session : null;
}

function forbidden() {
  return NextResponse.json({ ok: false, error: 'Se requiere una sesión de usuario.' }, { status: 401 });
}

function headers(key: string, session: NonNullable<Awaited<ReturnType<typeof sessionFor>>>) {
  return {
    'content-type': 'application/json',
    'x-chatpro-inbox-key': key,
    'x-chatpro-user-id': session.userId ?? '',
    'x-chatpro-user-name': session.fullName,
    'x-chatpro-company-id': session.companyId,
  };
}

async function forward(response: Response) {
  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' },
  });
}

export async function GET(request: NextRequest) {
  const session = await sessionFor(request);
  if (!session) return forbidden();
  const company = session.companySlug;
  try {
    const { apiBase, inboxKey } = config();
    const target = new URL(`${apiBase}/advisor-presence`);
    target.searchParams.set('company', company);
    return forward(await fetch(target,{headers:headers(inboxKey,session),cache:'no-store'}));
  } catch(error) {
    return NextResponse.json({ok:false,error:error instanceof Error?error.message:'No se pudo cargar la disponibilidad.'},{status:500});
  }
}

export async function PUT(request: NextRequest) {
  const session = await sessionFor(request);
  if (!session) return forbidden();
  const company = session.companySlug;
  try {
    const { apiBase, inboxKey } = config();
    const target = new URL(`${apiBase}/advisor-presence`);
    target.searchParams.set('company', company);
    return forward(await fetch(target,{method:'PUT',headers:headers(inboxKey,session),body:JSON.stringify(await request.json()),cache:'no-store'}));
  } catch(error) {
    return NextResponse.json({ok:false,error:error instanceof Error?error.message:'No se pudo actualizar la disponibilidad.'},{status:500});
  }
}
