/**
 * Safety gate for MW1's isolated SaaS staging environment.
 * Does not run on production and does not access network resources.
 */
export function assertStagingIsolation(env: NodeJS.ProcessEnv = process.env): void {
  if (env.MW1_STAGING_MODE !== 'true') return;

  const expectedHostname = 'zqfbxqszfnrbwpfukwak.supabase.co';
  let actualHostname = '';
  try {
    actualHostname = new URL(env.SUPABASE_URL || '').hostname.toLowerCase();
  } catch {
    throw new Error('STAGING BLOCKED: configure the isolated Supabase URL.');
  }

  if (actualHostname !== expectedHostname) {
    throw new Error('STAGING BLOCKED: Supabase URL is not the isolated MW1 staging project.');
  }

  const required = ['SUPABASE_SECRET_KEY', 'CHATPRO_INBOX_KEY'];
  for (const variable of required) {
    if (!env[variable] || env[variable]!.trim().length < 20) {
      throw new Error(`STAGING BLOCKED: an independent ${variable} is required.`);
    }
  }

  // Only a sandbox Mercado Pago credential may be present in staging.
  // Production Mercado Pago tokens and all other external channel/store/AI
  // credentials remain forbidden. This does not enable billing or messaging.
  // Do not crash the entire staging CRM when a non-test token is configured.
  // The Mercado Pago verification route rejects it before any provider request.
  // No checkout, payment, or subscription endpoints are enabled here.
  // These two public identifiers are pinned to the isolated Instagram pilot.
  // They cannot authorize requests, access accounts, or send messages alone.
  // The explicit secret gate allows only the pilot app's OAuth secret.
  // Other Meta credentials (including access tokens) remain forbidden.
  const instagramPilotPublicIds: Record<string, string> = {
    META_INSTAGRAM_APP_ID: '1079916404666757',
    META_INSTAGRAM_PLATFORM_APP_ID: '1674184274384954',
    META_INSTAGRAM_UNIFIED_CONFIG_ID: '2371579683591784',
  };
  for (const [name, expected] of Object.entries(instagramPilotPublicIds)) {
    if (env[name]?.trim() && env[name]?.trim() !== expected) {
      throw new Error('STAGING BLOCKED: unexpected Instagram pilot identifier.');
    }
  }
  const instagramSecretAllowed =
    env.MW1_STAGING_INSTAGRAM_SECRET_ALLOWED === 'true' &&
    env.META_INSTAGRAM_APP_ID === instagramPilotPublicIds.META_INSTAGRAM_APP_ID &&
    env.META_INSTAGRAM_UNIFIED_CONFIG_ID === instagramPilotPublicIds.META_INSTAGRAM_UNIFIED_CONFIG_ID &&
    Boolean(env.CHATPRO_INTEGRATIONS_ENCRYPTION_KEY?.trim());

  // A secret alone never enables login: authorization still requires
  // all separate pilot feature flags and membership/nonce checks.
  // Product-specific webhook signing secret is only permitted for the pinned
  // MW1 Instagram pilot app. Never permit Instagram access tokens or other
  // channel credentials, even when the secret gate is enabled.
  const instagramPlatformSecretAllowed = instagramSecretAllowed &&
    env.META_INSTAGRAM_PLATFORM_APP_ID ===
      instagramPilotPublicIds.META_INSTAGRAM_PLATFORM_APP_ID;
  const permittedExternal = [
    'MERCADOPAGO_ACCESS_TOKEN',
    'META_WHATSAPP_APP_ID',
    'META_WHATSAPP_EMBEDDED_CONFIG_ID',
    'META_WHATSAPP_APP_SECRET',
    'META_INSTAGRAM_APP_ID',
    'META_INSTAGRAM_PLATFORM_APP_ID',
    'META_INSTAGRAM_UNIFIED_CONFIG_ID',
    ...(instagramSecretAllowed ? ['META_INSTAGRAM_APP_SECRET'] : []),
    ...(instagramPlatformSecretAllowed ? ['META_INSTAGRAM_PLATFORM_APP_SECRET'] : []),
  ];
  const forbidden = Object.keys(env).filter((name) =>
    /^(SHOPIFY_|META_|WHATSAPP_|OPENAI_|TIKTOK_|TELEGRAM_|WOMPI_|MERCADOPAGO_|MERCADO_PAGO_)/i.test(name) &&
    !permittedExternal.includes(name) && Boolean(env[name]?.trim()),
  );
  if (forbidden.length) {
    throw new Error('STAGING BLOCKED: external messaging, store or AI credentials are configured.');
  }
}
