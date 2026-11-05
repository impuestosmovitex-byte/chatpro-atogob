/**
 * Offline contract for a future server-side MW1 Messenger pilot.
 *
 * IMPORTANT: No route calls this today. Staging Messenger remains blocked.
 * The caller MUST verify Meta user/page tokens server-side before invoking,
 * authorize the session's company and role, and consume a one-time OAuth nonce.
 * Never return a Page access token to the browser.
 */
export const MESSENGER_PILOT_REQUIRED_SCOPES = [
  'pages_show_list',
  'pages_messaging',
  'pages_manage_metadata',
] as const;

export type MessengerPilotPage = {
  id: string;
  name: string;
};

export type MessengerPilotEvidence = {
  companyId: string;
  sessionCompanyId: string;
  companySlug: string;
  isAuthorizedAdmin: boolean;
  selectedPageId: string;
  verifiedPages: MessengerPilotPage[];
  verifiedGrantedScopes: string[];
  verifiedPageAccessToken: string;
  pageAlreadyAssigned: boolean;
};

export type EncryptedMessengerPilotRecord = {
  company_id: string;
  provider: 'meta';
  integration_type: 'messenger';
  external_id: string;
  status: 'pending';
  credential_mode: 'encrypted';
  credentials_encrypted: string;
  credential_reference: { token_format: 'page_access_token' };
  config: {
    setup_source: 'mw1_staging_messenger_server_oauth';
    page_name: string;
    webhooks_subscribed: false;
    messaging_enabled: false;
  };
};

function reject(message: string): never {
  throw new Error(message);
}

/** Pure policy: does not exchange tokens, call Meta, or write to a database. */
export function preparePendingMessengerPilotRecord(
  evidence: MessengerPilotEvidence,
  encrypt: (credential: { access_token: string }) => string,
): EncryptedMessengerPilotRecord {
  if (
    !evidence.isAuthorizedAdmin ||
    evidence.companySlug !== 'piloto-mw1-prueba' ||
    !evidence.companyId ||
    evidence.companyId !== evidence.sessionCompanyId
  ) reject('Sesión o empresa piloto de Messenger no autorizada.');

  const granted = new Set(evidence.verifiedGrantedScopes);
  if (!MESSENGER_PILOT_REQUIRED_SCOPES.every(scope => granted.has(scope))) {
    reject('Meta no confirmó los permisos necesarios de Messenger.');
  }

  if (!/^[0-9]{6,30}$/.test(evidence.selectedPageId)) {
    reject('El identificador de la Página de Facebook no es válido.');
  }
  if (
    !Array.isArray(evidence.verifiedPages) ||
    evidence.verifiedPages.length === 0 ||
    evidence.verifiedPages.length > 100 ||
    evidence.verifiedPages.some(page =>
      !/^[0-9]{6,30}$/.test(page?.id || '') ||
      typeof page.name !== 'string' ||
      !page.name.trim() ||
      page.name.length > 160
    )
  ) reject('La lista de páginas autorizadas por Meta no es válida.');

  const uniqueIds = new Set(evidence.verifiedPages.map(page => page.id));
  if (uniqueIds.size !== evidence.verifiedPages.length) {
    reject('Meta devolvió páginas duplicadas, no se seleccionará ninguna.');
  }
  const page = evidence.verifiedPages.find(item => item.id === evidence.selectedPageId);
  if (!page) reject('La Página elegida no pertenece a la autorización verificada.');
  if (evidence.pageAlreadyAssigned) {
    reject('La Página ya está registrada en otra autorización de MW1.');
  }

  // Tokens are server-side only; length check is NOT a substitute for verifying
  // the token's app, permissions, Page identity and expiry with Meta.
  const rawToken = evidence.verifiedPageAccessToken;
  if (typeof rawToken !== 'string' || rawToken.trim().length < 20 ||
      rawToken.length > 8192) {
    reject('El token de Página verificado es inválido.');
  }

  const encrypted = encrypt({ access_token: rawToken });
  if (typeof encrypted !== 'string' || !encrypted ||
      encrypted === rawToken || encrypted.includes(rawToken)) {
    reject('No se pudo proteger la credencial de Messenger.');
  }

  return {
    company_id: evidence.companyId,
    provider: 'meta',
    integration_type: 'messenger',
    external_id: page.id,
    status: 'pending',
    credential_mode: 'encrypted',
    credentials_encrypted: encrypted,
    credential_reference: { token_format: 'page_access_token' },
    config: {
      setup_source: 'mw1_staging_messenger_server_oauth',
      page_name: page.name.trim(),
      webhooks_subscribed: false,
      messaging_enabled: false,
    },
  };
}
