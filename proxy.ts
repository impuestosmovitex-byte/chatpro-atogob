import { NextRequest, NextResponse } from 'next/server';
import {
  getInboxSession,
  INBOX_SESSION_COOKIE,
} from './app/lib/inbox-auth';
import { getAccessCapabilities } from './app/lib/access-capabilities';

const PUBLIC_PATHS = new Set([
  '/login',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/health',
  '/api/integrations/shopify/callback',
]);

const ADVISOR_ALLOWED_PAGES = [
  '/',
  '/clientes',
];

const ADVISOR_ALLOWED_APIS = [
  '/api/auth/session',
  '/api/auth/capabilities',
  '/api/auth/companies',
  '/api/auth/switch-company',
  '/api/inbox',
  '/api/clients',
  '/api/advisor-presence',
  '/api/quick-replies',
  '/api/storefront',
];

function matchesPath(pathname: string, allowedPath: string): boolean {
  if (allowedPath === '/') {
    return pathname === '/';
  }

  return (
    pathname === allowedPath ||
    pathname.startsWith(`${allowedPath}/`)
  );
}

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}

function canManagePlatform(roleKey: string): boolean {
  return roleKey === 'owner' || roleKey === 'admin';
}

function isAllowedForAdvisor(pathname: string): boolean {
  const allowed = pathname.startsWith('/api/')
    ? ADVISOR_ALLOWED_APIS
    : ADVISOR_ALLOWED_PAGES;

  return allowed.some((path) => matchesPath(pathname, path));
}

function isAutomationPath(pathname: string): boolean {
  return (
    matchesPath(pathname, '/automatizaciones') ||
    matchesPath(pathname, '/api/automations') ||
    matchesPath(pathname, '/api/automation-messages')
  );
}

function secureResponse(response: NextResponse): NextResponse {
  response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'same-origin');
  return response;
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (isPublicPath(pathname)) {
    return secureResponse(NextResponse.next());
  }

  const session = await getInboxSession(
    request.cookies.get(INBOX_SESSION_COOKIE)?.value,
  );

  if (pathname === '/login') {
    if (session) {
      return secureResponse(
        NextResponse.redirect(new URL('/', request.url)),
      );
    }

    return secureResponse(NextResponse.next());
  }

  if (!session) {
    if (pathname.startsWith('/api/')) {
      return secureResponse(
        NextResponse.json(
          { ok: false, error: 'Sesión requerida.' },
          { status: 401 },
        ),
      );
    }

    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);

    return secureResponse(NextResponse.redirect(loginUrl));
  }

  if (isAutomationPath(pathname)) {
    let allowed = false;

    try {
      allowed = (
        await getAccessCapabilities(session)
      ).automations;
    } catch {
      allowed = false;
    }

    if (!allowed) {
      if (pathname.startsWith('/api/')) {
        return secureResponse(
          NextResponse.json(
            {
              ok: false,
              error: 'No tienes permiso para administrar automatizaciones.',
            },
            { status: 403 },
          ),
        );
      }

      return secureResponse(
        NextResponse.redirect(new URL('/', request.url)),
      );
    }

    return secureResponse(NextResponse.next());
  }

  if (
    !canManagePlatform(session.roleKey) &&
    !isAllowedForAdvisor(pathname)
  ) {
    if (pathname.startsWith('/api/')) {
      return secureResponse(
        NextResponse.json(
          {
            ok: false,
            error: 'No tienes permiso para acceder a esta sección.',
          },
          { status: 403 },
        ),
      );
    }

    return secureResponse(
      NextResponse.redirect(new URL('/', request.url)),
    );
  }

  return secureResponse(NextResponse.next());
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
