import { NextRequest, NextResponse } from 'next/server';
import {
  getInboxSession,
  INBOX_SESSION_COOKIE,
} from './app/lib/inbox-auth';
import { getAccessCapabilities } from './app/lib/access-capabilities';

const PUBLIC_PATHS = new Set([
  '/login',
  '/inicio',
  '/precios',
  '/demo',
  '/integraciones',
  '/por-que',
  '/prueba-gratis',
  '/api/marketing/demo-request',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/health',
  '/api/integrations/shopify/callback',
  '/manifest.webmanifest',
  '/sw.js',
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
  '/api/contact-tags',
  '/api/advisor-presence',
  '/api/push-notifications',
  '/api/quick-replies',
  '/api/storefront',
  '/api/whatsapp-templates',
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
  // Enrollment has to run before any user session exists. Its API still
  // requires an exact staging Origin plus a 256-bit operator-issued code.
  const isStagingEnrollment =
    process.env.MW1_STAGING_MODE === 'true' &&
    (pathname === '/activar-administrador' ||
      pathname === '/api/staging-admin-setup');
  return PUBLIC_PATHS.has(pathname) || isStagingEnrollment;
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
    if(pathname==='/admin'||pathname.startsWith('/admin/'))
      loginUrl.searchParams.set('mode','platform');

    return secureResponse(NextResponse.redirect(loginUrl));
  }

  // A platform session has no tenant id. Never let it visit company pages
  // or their APIs. Tenant sessions cannot enter the platform.
  const isPlatformPath=pathname==='/admin'||pathname.startsWith('/admin/')||
    pathname==='/api/platform-admin'||pathname.startsWith('/api/platform-admin/');
  if(isPlatformPath && session.type!=='platform'){
    if(pathname.startsWith('/api/'))return secureResponse(NextResponse.json(
      {ok:false,error:'Requiere sesión independiente de superadministrador.'},{status:403}));
    return secureResponse(NextResponse.redirect(new URL('/login?mode=platform&next='+encodeURIComponent(pathname),request.url)));
  }
  if(session.type==='platform'){
    if(isPlatformPath || pathname==='/api/auth/session'||pathname==='/api/auth/logout')
      return secureResponse(NextResponse.next());
    if(pathname.startsWith('/api/'))return secureResponse(NextResponse.json(
      {ok:false,error:'Las cuentas de plataforma no acceden a datos de empresas.'},{status:403}));
    return secureResponse(NextResponse.redirect(new URL('/admin',request.url)));
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
