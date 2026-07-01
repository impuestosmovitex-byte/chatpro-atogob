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

  if (
    pathname === '/api/auth/login' ||
    pathname === '/api/auth/logout'
  ) {
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
    '/clientes',
    '/configuracion',
    '/configuracion/:path*',
    '/usuarios',
    '/usuarios/:path*',
    '/api/auth/session',
    '/api/inbox',
    '/api/inbox/:path*',
    '/api/clients',
    '/api/clients/:path*',
    '/api/settings',
    '/api/settings/:path*',
    '/api/users',
    '/api/users/:path*',
    '/api/roles',
    '/api/roles/:path*',
  ],
};
