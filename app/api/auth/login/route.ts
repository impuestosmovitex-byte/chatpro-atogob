import { NextRequest, NextResponse } from 'next/server';
import {
  createInboxSessionToken,
  INBOX_SESSION_COOKIE,
  INBOX_SESSION_MAX_AGE_SECONDS,
  passwordMatches,
  type ChatProSession,
} from '../../../lib/inbox-auth';

export const dynamic = 'force-dynamic';

type AccessResponse = {
  ok?: boolean;
  error?: string;
  setupRequired?: boolean;
  company?: {
    id: string;
    name: string;
    slug: string;
  };
  session?: Omit<ChatProSession, 'expiresAt'>;
};

type LoginBody = {
  identifier?: unknown;
  password?: unknown;
  company?: unknown;
};

function config() {
  const apiBase = process.env.CHATPRO_API_URL?.trim().replace(/\/$/, '');
  const inboxKey = process.env.CHATPRO_INBOX_KEY?.trim();

  if (!apiBase || !inboxKey) {
    throw new Error('Faltan CHATPRO_API_URL o CHATPRO_INBOX_KEY.');
  }

  return { apiBase, inboxKey };
}

function cleanCompany(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
    : '';
}

function companyFrom(body: LoginBody): string {
  const legacyPublicKey = ['NEXT', 'PUBLIC', 'CHATPRO', 'COMPANY'].join('_');
  const slug =
    cleanCompany(body.company) ||
    cleanCompany(process.env.CHATPRO_DEFAULT_COMPANY) ||
    cleanCompany(process.env.CHATPRO_COMPANY_SLUG) ||
    cleanCompany(process.env[legacyPublicKey]);

  if (!slug) {
    throw new Error(
      'Falta seleccionar la empresa o configurar CHATPRO_DEFAULT_COMPANY.',
    );
  }

  return slug;
}

function responseWithSession(session: Omit<ChatProSession, 'expiresAt'>) {
  const response = NextResponse.json({ ok: true });

  response.cookies.set({
    name: INBOX_SESSION_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });

  return createInboxSessionToken(session).then((token) => {
    response.cookies.set({
      name: INBOX_SESSION_COOKIE,
      value: token,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: INBOX_SESSION_MAX_AGE_SECONDS,
    });

    return response;
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as LoginBody;
    const identifier =
      typeof body.identifier === 'string' ? body.identifier.trim() : '';
    const password =
      typeof body.password === 'string' ? body.password : '';

    if (!password) {
      return NextResponse.json(
        { ok: false, error: 'Escribe tu contraseña.' },
        { status: 400 },
      );
    }

    const { apiBase, inboxKey } = config();
    const companySlug = companyFrom(body);

    if (identifier) {
      const target = new URL(`${apiBase}/access/login`);
      target.searchParams.set('company', companySlug);

      const accessResponse = await fetch(target, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-chatpro-inbox-key': inboxKey,
        },
        body: JSON.stringify({ identifier, password }),
        cache: 'no-store',
      });
      const data = (await accessResponse.json()) as AccessResponse;

      if (!accessResponse.ok || !data.ok || !data.session) {
        return NextResponse.json(
          {
            ok: false,
            error:
              data.error ||
              'La identificación o la contraseña no son correctas.',
          },
          { status: accessResponse.status || 401 },
        );
      }

      return responseWithSession(data.session);
    }

    if (!(await passwordMatches(password))) {
      return NextResponse.json(
        { ok: false, error: 'La contraseña no es correcta.' },
        { status: 401 },
      );
    }

    const target = new URL(`${apiBase}/access/bootstrap-status`);
    target.searchParams.set('company', companySlug);

    const statusResponse = await fetch(target, {
      headers: { 'x-chatpro-inbox-key': inboxKey },
      cache: 'no-store',
    });
    const status = (await statusResponse.json()) as AccessResponse;

    if (!statusResponse.ok || !status.ok || !status.company) {
      return NextResponse.json(
        {
          ok: false,
          error: status.error || 'No se pudo validar el acceso inicial.',
        },
        { status: statusResponse.status || 500 },
      );
    }

    if (!status.setupRequired) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'Ingresa tu identificación o código. El acceso inicial ya fue configurado.',
        },
        { status: 401 },
      );
    }

    return responseWithSession({
      type: 'bootstrap',
      userId: null,
      companyId: status.company.id,
      companySlug: status.company.slug,
      companyName: status.company.name,
      fullName: 'Configuración inicial',
      roleKey: 'owner',
      roleName: 'Propietario',
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'No se pudo iniciar sesión.',
      },
      { status: 500 },
    );
  }
}
