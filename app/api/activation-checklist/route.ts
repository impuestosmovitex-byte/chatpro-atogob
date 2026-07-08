import { NextRequest, NextResponse } from 'next/server';
import {
  getInboxSession,
  INBOX_SESSION_COOKIE,
} from '../../lib/inbox-auth';

export const dynamic = 'force-dynamic';

type JsonRecord = Record<string, unknown>;

type ChecklistItem = {
  key: string;
  title: string;
  description: string;
  status: 'ready' | 'pending' | 'warning';
  actionLabel: string;
  href: string;
};

function config() {
  const apiBase = process.env.CHATPRO_API_URL?.trim().replace(/\/$/, '');
  const inboxKey = process.env.CHATPRO_INBOX_KEY?.trim();

  if (!apiBase || !inboxKey) {
    throw new Error('Faltan CHATPRO_API_URL o CHATPRO_INBOX_KEY en la web.');
  }

  return { apiBase, inboxKey };
}

function canManage(session: Awaited<ReturnType<typeof getInboxSession>>) {
  if (!session) return false;

  if (session.type === 'bootstrap') {
    return session.roleKey === 'owner';
  }

  const role = session.roleKey?.trim().toLowerCase();

  return session.type === 'user' && (role === 'owner' || role === 'admin');
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isReady(value: boolean, warning = false): 'ready' | 'pending' | 'warning' {
  if (value) return 'ready';
  return warning ? 'warning' : 'pending';
}

async function fetchJson(
  apiBase: string,
  inboxKey: string,
  path: string,
  companySlug: string,
) {
  const target = new URL(`${apiBase}${path}`);
  target.searchParams.set('company', companySlug);

  try {
    const response = await fetch(target, {
      headers: { 'x-chatpro-inbox-key': inboxKey },
      cache: 'no-store',
    });

    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }

    return await response.json() as JsonRecord;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'No se pudo consultar.',
    };
  }
}

export async function GET(request: NextRequest) {
  const session = await getInboxSession(
    request.cookies.get(INBOX_SESSION_COOKIE)?.value,
  );

  if (!session) {
    return NextResponse.json(
      { ok: false, error: 'Sesión requerida.' },
      { status: 401 },
    );
  }

  if (!canManage(session)) {
    return NextResponse.json(
      { ok: false, error: 'No tienes permiso para ver esta configuración.' },
      { status: 403 },
    );
  }

  try {
    const { apiBase, inboxKey } = config();

    const [
      profileData,
      integrationsData,
      areasData,
      supportData,
      settingsData,
      quickRepliesData,
      usersData,
      rolesData,
    ] = await Promise.all([
      fetchJson(apiBase, inboxKey, '/company-profile', session.companySlug),
      fetchJson(apiBase, inboxKey, '/integrations', session.companySlug),
      fetchJson(apiBase, inboxKey, '/service-areas', session.companySlug),
      fetchJson(apiBase, inboxKey, '/support-settings', session.companySlug),
      fetchJson(apiBase, inboxKey, '/settings', session.companySlug),
      fetchJson(apiBase, inboxKey, '/quick-replies', session.companySlug),
      fetchJson(apiBase, inboxKey, '/users', session.companySlug),
      fetchJson(apiBase, inboxKey, '/roles', session.companySlug),
    ]);

    const identity = asRecord(profileData.identity);
    const integrations = asArray(integrationsData.integrations)
      .map(asRecord);
    const areas = asArray(areasData.areas)
      .map(asRecord);
    const support = asRecord(supportData.settings ?? supportData.configuration ?? supportData);
    const configuration = asRecord(settingsData.configuration);
    const commercialFlow = asRecord(configuration.commercialFlow);
    const knowledgeBase = asRecord(configuration.knowledgeBase);
    const quickReplies = asArray(quickRepliesData.quickReplies)
      .map(asRecord);
    const users = asArray(usersData.users)
      .map(asRecord);
    const roles = asArray(rolesData.roles)
      .map(asRecord);

    const identityReady = Boolean(
      text(identity.businessName) &&
      text(identity.country) &&
      text(identity.currency) &&
      text(identity.timezone),
    );
    const shopifyReady = integrations.some(
      (integration) =>
        integration.key === 'shopify' && integration.status === 'active',
    );
    const whatsappReady = integrations.some(
      (integration) =>
        integration.key === 'whatsapp' && integration.status === 'active',
    );
    const areasReady = areas.some((area) => area.isActive !== false);
    const hasSupportSettings =
      supportData.ok !== false &&
      (
        Object.keys(support).length > 0 ||
        typeof supportData.humanAttentionEnabled === 'boolean' ||
        Array.isArray(supportData.hours)
      );
    const assistantReady = Boolean(
      text(configuration.assistantName) ||
      text(commercialFlow.welcomeMessage) ||
      text(commercialFlow.salesInstructions) ||
      text(configuration.aiInstructions),
    );
    const knowledgeReady = Boolean(
      text(knowledgeBase.termsConditions) ||
      text(knowledgeBase.exchangesReturns) ||
      text(knowledgeBase.warranties) ||
      text(knowledgeBase.policiesFaq),
    );
    const quickRepliesReady = quickReplies.some(
      (reply) => reply.isActive !== false,
    );
    const usersReady = users.some((user) => user.active !== false);
    const rolesReady = roles.length > 0;

    const items: ChecklistItem[] = [
      {
        key: 'identity',
        title: 'Empresa e identidad',
        description: identityReady
          ? 'La empresa tiene datos básicos para operar.'
          : 'Completa nombre, país, moneda y zona horaria.',
        status: isReady(identityReady),
        actionLabel: identityReady ? 'Revisar identidad' : 'Completar identidad',
        href: '/configuracion/empresa-identidad',
      },
      {
        key: 'shopify',
        title: 'Tienda / catálogo',
        description: shopifyReady
          ? 'Shopify está conectado para leer productos reales.'
          : 'Conecta Shopify para catálogo, variantes, carrito y checkout.',
        status: isReady(shopifyReady),
        actionLabel: shopifyReady ? 'Ver integración' : 'Conectar Shopify',
        href: '/configuracion/integraciones',
      },
      {
        key: 'whatsapp',
        title: 'WhatsApp real',
        description: whatsappReady
          ? 'WhatsApp aparece conectado para esta empresa.'
          : 'Aún falta conectar el canal real de WhatsApp.',
        status: whatsappReady ? 'ready' : 'warning',
        actionLabel: 'Ver integraciones',
        href: '/configuracion/integraciones',
      },
      {
        key: 'areas',
        title: 'Áreas de atención',
        description: areasReady
          ? 'Hay áreas activas para enrutar conversaciones.'
          : 'Crea áreas como Ventas, Servicio, Garantías o Logística.',
        status: isReady(areasReady),
        actionLabel: areasReady ? 'Revisar áreas' : 'Crear áreas',
        href: '/configuracion/areas-atencion',
      },
      {
        key: 'hours',
        title: 'Horarios y atención humana',
        description: hasSupportSettings
          ? 'Hay configuración de atención para asesores.'
          : 'Define horarios y reglas para pasar a humano.',
        status: isReady(hasSupportSettings, true),
        actionLabel: 'Revisar horarios',
        href: '/configuracion/horarios-atencion',
      },
      {
        key: 'users',
        title: 'Usuarios y roles',
        description: usersReady && rolesReady
          ? 'La empresa tiene usuarios y roles configurados.'
          : 'Crea usuarios, roles y permisos para el equipo.',
        status: isReady(usersReady && rolesReady),
        actionLabel: 'Revisar usuarios',
        href: '/usuarios',
      },
      {
        key: 'ai',
        title: 'IA y ventas',
        description: assistantReady
          ? 'El asistente tiene reglas comerciales configuradas.'
          : 'Configura nombre, tono, saludo, ventas, pagos y checkout.',
        status: isReady(assistantReady),
        actionLabel: assistantReady ? 'Revisar IA' : 'Configurar IA',
        href: '/configuracion/ia',
      },
      {
        key: 'knowledge',
        title: 'Base de conocimiento',
        description: knowledgeReady
          ? 'Hay políticas aprobadas para responder con más precisión.'
          : 'Agrega términos, cambios, garantías y preguntas frecuentes.',
        status: isReady(knowledgeReady),
        actionLabel: knowledgeReady ? 'Revisar base' : 'Agregar base',
        href: '/configuracion/ia',
      },
      {
        key: 'quick-replies',
        title: 'Respuestas rápidas',
        description: quickRepliesReady
          ? 'Hay respuestas rápidas activas para asesores.'
          : 'Opcional: crea atajos para respuestas repetidas.',
        status: isReady(quickRepliesReady, true),
        actionLabel: 'Revisar respuestas',
        href: '/configuracion/respuestas-rapidas',
      },
    ];

    const ready = items.filter((item) => item.status === 'ready').length;
    const blocking = items.filter((item) => item.status === 'pending').length;
    const warning = items.filter((item) => item.status === 'warning').length;
    const total = items.length;

    return NextResponse.json({
      ok: true,
      company: {
        id: session.companyId,
        slug: session.companySlug,
        name: session.companyName,
      },
      summary: {
        ready,
        blocking,
        warning,
        total,
        percent: Math.round((ready / total) * 100),
        canActivateRealCompany:
          identityReady &&
          shopifyReady &&
          areasReady &&
          usersReady &&
          rolesReady &&
          assistantReady &&
          knowledgeReady,
      },
      items,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'No se pudo construir el checklist.',
      },
      { status: 500 },
    );
  }
}
