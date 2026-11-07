import { NextRequest, NextResponse } from 'next/server';
import { getInboxSession, INBOX_SESSION_COOKIE } from '../../../lib/inbox-auth';

export const dynamic = 'force-dynamic';
const REVIEWER_ROLE = 'meta_reviewer_atogob';
const REVIEWER_IDENTIFIER = 'META-MW1-REVIEW';
const EXPECTED_ORIGIN = 'https://chatpro-web-production.up.railway.app';

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', 'Pragma': 'no-cache' },
  });
}

export async function POST(request: NextRequest) {
  // This is a deliberate one-time operator action, not a public signup.
  if (request.headers.get('origin') !== EXPECTED_ORIGIN) {
    return json({ ok: false, error: 'Origen no autorizado.' }, 403);
  }

  const session = await getInboxSession(request.cookies.get(INBOX_SESSION_COOKIE)?.value);
  if (
    session?.type !== 'user' ||
    session.companySlug !== 'atogob' ||
    session.roleKey !== 'owner'
  ) {
    return json({ ok: false, error: 'Solo el propietario de ATOGOB puede crear este acceso.' }, 403);
  }

  const apiBase = process.env.CHATPRO_API_URL?.trim().replace(/\/$/, '');
  const inboxKey = process.env.CHATPRO_INBOX_KEY?.trim();
  if (!apiBase || !inboxKey) {
    return json({ ok: false, error: 'Configuración del servidor incompleta.' }, 503);
  }

  try {
    // Fail closed if reviewer role is not installed or is overprivileged.
    const roleCheck = await fetch(new URL('/roles?company=atogob', apiBase), {
      headers: { 'x-chatpro-inbox-key': inboxKey },
      cache: 'no-store',
    });
    if (!roleCheck.ok) return json({ ok: false, error: 'No se pudieron comprobar los permisos del revisor.' }, 503);
    const roleData = await roleCheck.json() as {
      roles?: Array<{ key: string; permissions?: Array<{ key: string }> }>;
    };
    const reviewerRole = roleData.roles?.find(r => r.key === REVIEWER_ROLE);
    const allowedPermissions = ['company.view'];
    if (!reviewerRole || !Array.isArray(reviewerRole.permissions) ||
      reviewerRole.permissions.some(p => !allowedPermissions.includes(p.key)) ||
      reviewerRole.permissions.length !== 1) {
      return json({ ok: false, error: 'El rol revisor no tiene la configuración segura prevista.' }, 409);
    }

    const usersResponse = await fetch(new URL('/users?company=atogob', apiBase), {
      headers: { 'x-chatpro-inbox-key': inboxKey },
      cache: 'no-store',
    });
    if (!usersResponse.ok) return json({ ok: false, error: 'No se pudo verificar si ya existe el revisor.' }, 503);
    const usersData = await usersResponse.json() as {
      users?: Array<{ identifier: string; roleKey: string; active: boolean }>;
    };
    if (usersData.users?.some(u => u.identifier === REVIEWER_IDENTIFIER)) {
      return json({ ok: false, alreadyExists: true,
        error: 'El revisor ya fue creado. No se repetirá la operación ni cambiará su contraseña.' }, 409);
    }

    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const password = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

    const response = await fetch(new URL('/users?company=atogob', apiBase), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-chatpro-inbox-key': inboxKey },
      body: JSON.stringify({
        fullName: 'Revisor Meta MW1',
        identifier: REVIEWER_IDENTIFIER,
        password,
        roleKey: REVIEWER_ROLE,
        areaIds: [],
      }),
      cache: 'no-store',
    });

    if (!response.ok) {
      const result = await response.json().catch(() => ({})) as { message?: string };
      return json({ ok: false, error: result.message || 'No se pudo crear el usuario.' }, response.status);
    }

    // Show the secret only to the owner, exactly once. Never log or store it in the UI.
    return json({ ok: true, identifier: REVIEWER_IDENTIFIER, password,
      note: 'Guarda ahora estos datos en un lugar seguro. No volverán a mostrarse.' }, 201);
  } catch {
    return json({ ok: false, error: 'No se pudo completar el acceso.' }, 503);
  }
}
