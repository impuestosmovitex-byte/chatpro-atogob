import type { ChatProSession } from './inbox-auth';

export type AccessCapabilities = {
  inbox: boolean;
  clients: boolean;
  manageClients: boolean;
  startConversations: boolean;
  storefront: boolean;
  sendAudio: boolean;
  sendTemplates: boolean;
  useQuickReplies: boolean;
  sendMedia: boolean;
  health: boolean;
  automations: boolean;
  configuration: boolean;
  testAgent: boolean;
};

type CapabilitiesResponse = {
  ok?: boolean;
  error?: string;
  capabilities?: Partial<AccessCapabilities>;
};

const FULL_ACCESS: AccessCapabilities = {
  inbox: true,
  clients: true,
  manageClients: true,
  startConversations: true,
  storefront: true,
  sendAudio: true,
  sendTemplates: true,
  useQuickReplies: true,
  sendMedia: true,
  health: true,
  automations: true,
  configuration: true,
  testAgent: true,
};

function config() {
  const apiBase = process.env.CHATPRO_API_URL?.trim().replace(/\/$/, '');
  const inboxKey = process.env.CHATPRO_INBOX_KEY?.trim();

  if (!apiBase || !inboxKey) {
    throw new Error('Faltan CHATPRO_API_URL o CHATPRO_INBOX_KEY.');
  }

  return { apiBase, inboxKey };
}

export async function getAccessCapabilities(
  session: ChatProSession,
): Promise<AccessCapabilities> {
  if (session.type === 'bootstrap') {
    return FULL_ACCESS;
  }

  if (!session.userId) {
    throw new Error('Sesión de usuario no válida.');
  }

  const { apiBase, inboxKey } = config();
  const target = new URL(`${apiBase}/access-capabilities`);
  target.searchParams.set('company', session.companySlug);
  target.searchParams.set('user', session.userId);

  const response = await fetch(target, {
    headers: {
      'x-chatpro-inbox-key': inboxKey,
    },
    cache: 'no-store',
  });

  const data = (await response.json()) as CapabilitiesResponse;

  if (!response.ok || !data.ok || !data.capabilities) {
    throw new Error(
      data.error || 'No se pudieron validar los permisos del usuario.',
    );
  }

  return {
    inbox: data.capabilities.inbox === true,
    clients: data.capabilities.clients === true,
    manageClients: data.capabilities.manageClients === true,
    startConversations:
      data.capabilities.startConversations === true,
    storefront: data.capabilities.storefront === true,
    sendAudio: data.capabilities.sendAudio === true,
    sendTemplates: data.capabilities.sendTemplates === true,
    useQuickReplies: data.capabilities.useQuickReplies === true,
    sendMedia: data.capabilities.sendMedia === true,
    health: data.capabilities.health === true,
    automations: data.capabilities.automations === true,
    configuration: data.capabilities.configuration === true,
    testAgent: data.capabilities.testAgent === true,
  };
}
