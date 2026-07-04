import { NextRequest, NextResponse } from 'next/server';
import {
  getInboxSession,
  INBOX_SESSION_COOKIE,
} from './app/lib/inbox-auth';

const RESTRICTED_PAGES = [
  '/configuracion',
  '/usuarios',
];

const RESTRICTED_APIS = [
  '/api/settings',
  '/api/company-profile',
  '/api/integrations',
  '/api/users',
  '/api/roles',
  '/api/service-areas',
  '/api/support-settings',
];

function isRestrictedPath(pathname: string): boolean {
  return RESTRICTED_PAGES.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  ) || RESTRICTED_APIS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

function canManageConfiguration(roleKey: string): boolean {
  return roleKey === 'owner' || roleKey === 'admin';
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const session = await getInboxSession(
    request.cookies.get(INBOX_SESSION_COOKIE)?.value,
  );

  if (pathname === '/login') {
    if (session) {
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

  if (!session) {
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

  if (
    isRestrictedPath(pathname) &&
    !canManageConfiguration(session.roleKey)
  ) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { ok: false, error: 'No tienes permiso para acceder a esta sección.' },
        { status: 403 },
      );
    }

    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
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
    '/api/company-profile',
    '/api/company-profile/:path*',
    '/api/integrations',
    '/api/integrations/:path*',
    '/api/users',
    '/api/users/:path*',
    '/api/roles',
    '/api/roles/:path*',
    '/api/service-areas',
    '/api/service-areas/:path*',
    '/api/support-settings',
    '/api/support-settings/:path*',
  ],
};
