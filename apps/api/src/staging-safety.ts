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

  // Intentionally reject third-party credentials in staging. These integrations
  // will be tested later with separately approved sandbox resources.
  const forbidden = Object.keys(env).filter((name) =>
    /^(SHOPIFY_|META_|WHATSAPP_|OPENAI_|TIKTOK_|TELEGRAM_|WOMPI_|MERCADOPAGO_|MERCADO_PAGO_)/i.test(name) &&
    Boolean(env[name]?.trim()),
  );
  if (forbidden.length) {
    throw new Error('STAGING BLOCKED: external messaging, store or AI credentials are configured.');
  }
}
