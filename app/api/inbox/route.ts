import { NextRequest, NextResponse } from 'next/server';
import {
  INBOX_SESSION_COOKIE,
  getInboxSession,
} from '../../lib/inbox-auth';

export const dynamic = 'force-dynamic';

type InboxRequestBody = {
  company?: unknown;
  sessionId?: unknown;
  action?: unknown;
  agentName?: unknown;
  message?: unknown;
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function config() {
  const apiBase = process.env.CHATPRO_API_URL?.trim().replace(/\/$/, '');
  const inboxKey = process.env.CHATPRO_INBOX_KEY?.trim();

  if (!apiBase || !inboxKey) {
    throw new Error('Faltan CHATPRO_API_URL o CHATPRO_INBOX_KEY en la web.');
  }

  return { apiBase, inboxKey };
}

async function currentSession(request: NextRequest) {
  return getInboxSession(request.cookies.get(INBOX_SESSION_COOKIE)?.value);
}

function trustedHeaders(inboxKey: string, session: NonNullable<Awaited<ReturnType<typeof currentSession>>>) {
  const headers: Record<string, string> = { 'x-chatpro-inbox-key': inboxKey };
  if (session.type === 'user' && session.userId) {
    headers['x-chatpro-user-id'] = session.userId;
    headers['x-chatpro-user-name'] = session.fullName;
    headers['x-chatpro-company-id'] = session.companyId;
    headers['x-chatpro-role-key'] = session.roleKey;
  }
  return headers;
}

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: 'Sesión requerida.' },
    { status: 401 },
  );
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
  const session = await currentSession(request);
  if (!session) return unauthorized();

  try {
    const { apiBase, inboxKey } = config();
    const company = request.nextUrl.searchParams.get('company')?.trim() ?? '';
    const sessionId = request.nextUrl.searchParams.get('sessionId')?.trim() ?? '';
    const status = request.nextUrl.searchParams.get('status')?.trim() ?? 'all';
    const limit = request.nextUrl.searchParams.get('limit')?.trim() ?? '60';

    if (!company) {
      return NextResponse.json({ ok: false, error: 'Falta la empresa.' }, { status: 400 });
    }

    const target = new URL(
      sessionId ? `${apiBase}/inbox/${encodeURIComponent(sessionId)}` : `${apiBase}/inbox`,
    );
    target.searchParams.set('company', company);

    if (!sessionId) {
      target.searchParams.set('status', status);
      target.searchParams.set('limit', limit);
    }

    const response = await fetch(target, {
      headers: trustedHeaders(inboxKey, session),
      cache: 'no-store',
    });

    return proxyResponse(response);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'No se pudo conectar la bandeja.',
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const session = await currentSession(request);
  if (!session) return unauthorized();

  try {
    const { apiBase, inboxKey } = config();
    const body = (await request.json()) as InboxRequestBody;
    const company = text(body.company);
    const sessionId = text(body.sessionId);
    const action = text(body.action);

    if (!company || !sessionId) {
      return NextResponse.json({ ok: false, error: 'Falta conversación o empresa.' }, { status: 400 });
    }

    const suffix =
      action === 'take'
        ? 'take'
        : action === 'close'
          ? 'close'
          : action === 'resume_ai'
            ? 'resume-ai'
            : action === 'message'
              ? 'messages'
              : '';

    if (!suffix) {
      return NextResponse.json({ ok: false, error: 'Acción no válida.' }, { status: 400 });
    }

    const target = new URL(
      `${apiBase}/inbox/${encodeURIComponent(sessionId)}/${suffix}`,
    );
    target.searchParams.set('company', company);

    const response = await fetch(target, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...trustedHeaders(inboxKey, session),
      },
      body: JSON.stringify({
        message: text(body.message),
      }),
      cache: 'no-store',
    });

    return proxyResponse(response);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'No se pudo procesar la acción.',
      },
      { status: 500 },
    );
  }
}
