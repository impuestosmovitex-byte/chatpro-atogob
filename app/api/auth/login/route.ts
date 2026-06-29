import { NextRequest, NextResponse } from 'next/server';
import {
  createInboxSessionToken,
  INBOX_SESSION_COOKIE,
  INBOX_SESSION_MAX_AGE_SECONDS,
  passwordMatches,
} from '../../../lib/inbox-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { password?: unknown };
    const password =
      typeof body.password === 'string' ? body.password : '';

    if (!password || !(await passwordMatches(password))) {
      return NextResponse.json(
        { ok: false, error: 'La contraseña no es correcta.' },
        { status: 401 },
      );
    }

    const response = NextResponse.json({ ok: true });

    response.cookies.set({
      name: INBOX_SESSION_COOKIE,
      value: await createInboxSessionToken(),
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: INBOX_SESSION_MAX_AGE_SECONDS,
    });

    return response;
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
