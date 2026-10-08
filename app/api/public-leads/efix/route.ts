import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const COMPANY_SLUG = 'emprende-con-maogo';
const COMPANY_ID = 'd55817a3-d104-48e7-8efb-c7736e9c8aa4';
const EVENT_TAG = 'EFIX-2026';

const ALLOWED_ORIGINS = new Set([
  'https://emprendeconmaogo.com',
  'https://www.emprendeconmaogo.com',
]);

function config() {
  const apiBase = process.env.CHATPRO_API_URL?.trim().replace(/\/$/, '');
  const inboxKey = process.env.CHATPRO_INBOX_KEY?.trim();

  if (!apiBase || !inboxKey) {
    throw new Error('Faltan CHATPRO_API_URL o CHATPRO_INBOX_KEY en la web.');
  }

  return { apiBase, inboxKey };
}

function clean(value: unknown, max = 500): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, max)
    : '';
}

function readBoolean(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'si', 'sí', 'yes', 'on'].includes(
    value.trim().toLowerCase(),
  );
}

function normalizePhone(value: unknown): string {
  let digits = clean(value, 40).replace(/\D+/g, '');

  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  if (digits.length === 10 && digits.startsWith('3')) {
    digits = `57${digits}`;
  }

  if (digits.length < 8 || digits.length > 15) {
    return '';
  }

  return digits;
}

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function objectiveTag(value: string): string | null {
  const normalized = value.toLowerCase();

  if (normalized.includes('oportunidades laborales')) return 'QUIERE-TRABAJO';
  if (normalized.includes('propio negocio')) return 'QUIERE-EMPRENDER';
  if (normalized.includes('negocio actual')) return 'TIENE-NEGOCIO';
  if (normalized.includes('nuevas habilidades')) return 'QUIERE-APRENDER';
  if (normalized.includes('no estoy seguro')) return 'SIN-OBJETIVO-DEFINIDO';

  return null;
}

function trainingTag(value: string): string | null {
  const normalized = value.toLowerCase();

  if (normalized.startsWith('sí') || normalized.startsWith('si')) {
    return 'CAPACITANDOSE';
  }

  if (normalized.includes('quiero empezar')) return 'QUIERE-CAPACITARSE';
  if (normalized === 'no') return 'NO-SE-CAPACITA';

  return null;
}

function corsHeaders(request: NextRequest): Record<string, string> {
  const origin = request.headers.get('origin')?.trim() ?? '';

  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    return {};
  }

  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    vary: 'Origin',
  };
}

function json(
  request: NextRequest,
  body: Record<string, unknown>,
  status = 200,
) {
  return NextResponse.json(body, {
    status,
    headers: corsHeaders(request),
  });
}

async function bodyFrom(request: NextRequest): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    const body = await request.json();
    return body && typeof body === 'object'
      ? (body as Record<string, unknown>)
      : {};
  }

  const form = await request.formData();
  return Object.fromEntries(form.entries());
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request),
  });
}

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get('origin')?.trim() ?? '';

    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return json(request, { ok: false, error: 'Origen no permitido.' }, 403);
    }

    const body = await bodyFrom(request);

    // Campo trampa opcional para bots. Si viene lleno, respondemos OK sin crear nada.
    if (clean(body.website, 200)) {
      return json(request, { ok: true });
    }

    const fullName = clean(body.nombre ?? body.fullName, 120);
    const phone = normalizePhone(
      body.telefono_whatsapp ?? body.whatsapp ?? body.phone,
    );
    const email = clean(body.correo ?? body.email, 180).toLowerCase();
    const objective = clean(body.objetivo ?? body.objective, 260);
    const question1 = clean(
      body.respuesta_pregunta_1 ?? body.question1,
      500,
    );
    const training = clean(
      body.capacitacion_actual ?? body.training,
      300,
    );
    const question3 = clean(
      body.respuesta_pregunta_3 ?? body.question3,
      500,
    );
    const consent = readBoolean(
      body.consentimiento_contacto ?? body.consent,
    );

    if (!fullName || !phone || !email || !objective) {
      return json(
        request,
        {
          ok: false,
          error: 'Completa nombre, WhatsApp, correo y objetivo.',
        },
        400,
      );
    }

    if (!validEmail(email)) {
      return json(request, { ok: false, error: 'Correo no válido.' }, 400);
    }

    if (!consent) {
      return json(
        request,
        {
          ok: false,
          error: 'Debes aceptar la autorización de contacto.',
        },
        400,
      );
    }

    const tags = [EVENT_TAG];
    const objectiveSegment = objectiveTag(objective);
    const trainingSegment = trainingTag(training);

    if (objectiveSegment) tags.push(objectiveSegment);
    if (trainingSegment) tags.push(trainingSegment);

    const registeredAt = new Date().toISOString();
    const notes = [
      'LEAD EFIX 2026',
      `Correo: ${email}`,
      `Objetivo: ${objective}`,
      `Pregunta 1: ${question1 || 'Sin respuesta'}`,
      `Capacitación actual: ${training || 'Sin respuesta'}`,
      `Pregunta 3: ${question3 || 'Sin respuesta'}`,
      'Fuente: Feria',
      'Origen: QR Stand',
      'Evento: EFIX 2026',
      'Estado lead: Lead nuevo',
      `Consentimiento contacto: Sí (${registeredAt})`,
    ].join('\n');

    const { apiBase, inboxKey } = config();
    const target = new URL(`${apiBase}/clients`);
    target.searchParams.set('company', COMPANY_SLUG);

    const response = await fetch(target, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-chatpro-inbox-key': inboxKey,
        'x-chatpro-session-type': 'bootstrap',
        'x-chatpro-user-name': 'Registro EFIX 2026',
        'x-chatpro-company-id': COMPANY_ID,
        'x-chatpro-role-key': 'owner',
      },
      body: JSON.stringify({
        action: 'create',
        company: COMPANY_SLUG,
        phone,
        displayName: fullName,
        tags,
        notes,
      }),
      cache: 'no-store',
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error('[EFIX lead] MW1 rechazó el registro:', detail);
      return json(
        request,
        {
          ok: false,
          error: 'No pudimos guardar tu registro. Intenta nuevamente.',
        },
        502,
      );
    }

    return json(request, {
      ok: true,
      message: 'Registro guardado correctamente.',
      lead: {
        nombre: fullName,
        telefono_whatsapp: phone,
        correo: email,
        objetivo: objective,
        etiquetas: tags,
        evento: 'EFIX 2026',
        estado_lead: 'Lead nuevo',
      },
    });
  } catch (error) {
    console.error('[EFIX lead] Error inesperado:', error);
    return json(
      request,
      {
        ok: false,
        error: 'No pudimos guardar tu registro. Intenta nuevamente.',
      },
      500,
    );
  }
}
