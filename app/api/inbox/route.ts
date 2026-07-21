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
  targetUserId?: unknown;
  templateId?: unknown;
  variables?: unknown;
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
    const company = session.companySlug;
    const sessionId = request.nextUrl.searchParams.get('sessionId')?.trim() ?? '';
    const after = request.nextUrl.searchParams.get('after')?.trim() ?? '';
    const mode = request.nextUrl.searchParams.get('mode')?.trim() ?? '';
    const status = request.nextUrl.searchParams.get('status')?.trim() ?? 'all';
    const limit = request.nextUrl.searchParams.get('limit')?.trim() ?? '60';

    const target = new URL(
      mode === 'transfer-targets'
        ? `${apiBase}/inbox/transfer-targets`
        : sessionId
          ? `${apiBase}/inbox/${encodeURIComponent(sessionId)}`
          : `${apiBase}/inbox`,
    );
    target.searchParams.set('company', company);

    if (sessionId && after) {
      target.searchParams.set('after', after);
    }

    if (!sessionId && mode !== 'transfer-targets') {
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
    const company = session.companySlug;
    const sessionId = text(body.sessionId);
    const action = text(body.action);

    if (action === 'template') {
      if (!sessionId) {
        return NextResponse.json(
          { ok: false, error: 'Falta la conversación.' },
          { status: 400 },
        );
      }

      const target = new URL(
        `${apiBase}/inbox/${encodeURIComponent(sessionId)}/templates`,
      );
      target.searchParams.set('company', company);

      const response = await fetch(target, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...trustedHeaders(inboxKey, session),
        },
        body: JSON.stringify({
          templateId: text(body.templateId),
          variables:
            body.variables &&
            typeof body.variables === 'object' &&
            !Array.isArray(body.variables)
              ? body.variables
              : {},
        }),
        cache: 'no-store',
      });

      return proxyResponse(response);
    }

    const internalTestAction =
      action === 'internal_test_start'
        ? 'start'
        : action === 'internal_test_message'
          ? 'message'
          : '';

    if (internalTestAction) {
      if (internalTestAction === 'message' && !sessionId) {
        return NextResponse.json({ ok: false, error: 'Falta la conversación de prueba.' }, { status: 400 });
      }

      const target = new URL(`${apiBase}/inbox/internal-test`);
      target.searchParams.set('company', company);

      const response = await fetch(target, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...trustedHeaders(inboxKey, session),
        },
        body: JSON.stringify({
          action: internalTestAction,
          sessionId,
          message: text(body.message),
        }),
        cache: 'no-store',
      });

      return proxyResponse(response);
    }

    if (!sessionId) {
      return NextResponse.json({ ok: false, error: 'Falta la conversación.' }, { status: 400 });
    }

    const suffix =
      action === 'take'
        ? 'take'
        : action === 'transfer'
          ? 'transfer'
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
        targetUserId: text(body.targetUserId),
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
