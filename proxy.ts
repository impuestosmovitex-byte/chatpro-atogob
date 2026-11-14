import { NextRequest, NextResponse } from 'next/server';
import {
  getInboxSession,
  INBOX_SESSION_COOKIE,
} from './app/lib/inbox-auth';
import { getAccessCapabilities } from './app/lib/access-capabilities';
import { isUnifiedPanelEnabled } from './app/lib/unified-panel-rollout';

const PUBLIC_PATHS = new Set([
  '/login',
  '/inicio',
  '/precios',
  '/demo',
  '/integraciones',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/health',
  '/api/integrations/shopify/callback',
  '/manifest.webmanifest',
  '/sw.js',
]);

const ADVISOR_ALLOWED_PAGES = [
  '/',
  '/panel',
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

function isStatisticsPath(pathname: string): boolean {
  return (
    matchesPath(pathname, '/estadisticas') ||
    matchesPath(pathname, '/api/statistics')
  );
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

  // A signed-in user must not be sent back to the login form.
  // An opted-in tenant opens the new panel, everyone else keeps the old CRM.
  if (pathname === '/login') {
    const loginSession = await getInboxSession(
      request.cookies.get(INBOX_SESSION_COOKIE)?.value,
    );
    if (loginSession) {
      const destination = loginSession.type === 'user' &&
        isUnifiedPanelEnabled(loginSession.companySlug) ? '/panel' : '/';
      return secureResponse(NextResponse.redirect(new URL(destination, request.url)));
    }
    return secureResponse(NextResponse.next());
  }

  if (isPublicPath(pathname)) {
    return secureResponse(NextResponse.next());
  }

  const session = await getInboxSession(
    request.cookies.get(INBOX_SESSION_COOKIE)?.value,
  );

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

  // Isolated, non-operational Meta reviewer. No customer PII or write APIs.
  // This check precedes every normal advisor/manager route.
  if (
    session.type === 'user' &&
    session.companySlug === 'atogob' &&
    session.roleKey === 'meta_reviewer_atogob'
  ) {
    if (pathname === '/revision-atogob') {
      return secureResponse(NextResponse.next());
    }
    if (pathname.startsWith('/api/')) {
      return secureResponse(
        NextResponse.json(
          { ok: false, error: 'Revisor Meta: las API operativas no están autorizadas.' },
          { status: 403, headers: { 'Cache-Control': 'no-store' } },
        ),
      );
    }
    return secureResponse(
      NextResponse.redirect(new URL('/revision-atogob', request.url)),
    );
  }

  // Opt-in only. Revalidate the CURRENT company membership at the gateway,
  // not only inside the browser. No impact on the original CRM routes.
  if (pathname === '/panel') {
    if (session.type !== 'user' || !session.userId ||
        !isUnifiedPanelEnabled(session.companySlug)) {
      return secureResponse(NextResponse.redirect(new URL('/', request.url)));
    }
    try {
      await getAccessCapabilities(session);
    } catch {
      // Revoked tenant access or unreachable authorization API: fail closed.
      return secureResponse(NextResponse.redirect(new URL('/', request.url)));
    }
  }

  // SEG-002: only a verified individual can enter Statistics.
  // The role stored in a long-lived session is never sufficient here.
  if (isStatisticsPath(pathname)) {
    if (session.type !== 'user' || !session.userId) {
      if (pathname.startsWith('/api/')) {
        return secureResponse(NextResponse.json(
          { ok: false, error: 'Inicia sesión con un usuario autorizado.' },
          { status: 403 },
        ));
      }
      return secureResponse(NextResponse.redirect(new URL('/', request.url)));
    }

    let allowed = false;
    try {
      allowed = (await getAccessCapabilities(session)).statistics;
    } catch {
      allowed = false;
    }
    if (!allowed) {
      if (pathname.startsWith('/api/')) {
        return secureResponse(NextResponse.json(
          { ok: false, error: 'No tienes permiso para consultar estadísticas.' },
          { status: 403 },
        ));
      }
      return secureResponse(NextResponse.redirect(new URL('/', request.url)));
    }
    return secureResponse(NextResponse.next());
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
