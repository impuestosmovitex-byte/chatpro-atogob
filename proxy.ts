import { NextRequest, NextResponse } from 'next/server';
import {
  INBOX_SESSION_COOKIE,
  isInboxSessionValid,
} from './app/lib/inbox-auth';

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const authenticated = await isInboxSessionValid(
    request.cookies.get(INBOX_SESSION_COOKIE)?.value,
  );

  if (pathname === '/login') {
    if (authenticated) {
      return NextResponse.redirect(new URL('/', request.url));
    }

    return NextResponse.next();
  }

  if (authenticated) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { ok: false, error: 'Sesión requerida.' },
      { status: 401 },
    );
  }

  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('next', pathname);

  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    '/',
    '/login',
    '/configuracion',
    '/api/inbox',
    '/api/inbox/:path*',
    '/api/settings',
    '/api/settings/:path*',
  ],
};
