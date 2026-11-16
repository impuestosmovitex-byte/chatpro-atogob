'use strict';
/**
 * Never use production/staging deployment variables to start the media lab.
 * Pure configuration preflight (no network calls, no secrets printed).
 * The initial lab has no database at all. No storage/service credentials allowed.
 * This file is NOT a server or a deployment recipe.
 */
const FORBIDDEN = [
  'CHATPRO_INBOX_KEY', 'CHATPRO_API_URL', 'DATABASE_URL',
  'META_WHATSAPP_APP_SECRET', 'META_INSTAGRAM_APP_SECRET',
  'META_MESSENGER_WEBHOOK_VERIFY_TOKEN', 'WHATSAPP_ACCESS_TOKEN',
  'SHOPIFY_ACCESS_TOKEN', 'REDIS_URL',
  'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
  'STRIPE_SECRET_KEY', 'MERCADOPAGO_ACCESS_TOKEN',
];
const REQUIRED = [
  'MW1_MEDIA_LAB_DATASET_ID',
  'MW1_MEDIA_LAB_AUTH_SECRET',
];
function validateMediaLabEnv(env = {}) {
  const reasons = [];
  if (env.MW1_MEDIA_LAB_MODE !== 'true' ||
    env.MW1_MEDIA_LAB_ALLOW_START !== 'true') {
    reasons.push('LAB_SWITCHES_REQUIRED');
  }
  for (const key of FORBIDDEN) if (env[key] !== undefined) {
    reasons.push('FORBIDDEN_ENV:' + key);
  }
  for (const key of Object.keys(env)) if (key.startsWith('MW1_STAGING_')) {
    reasons.push('STAGING_ENV_NOT_ALLOWED:' + key);
  }
  if (typeof env.MW1_MEDIA_LAB_AUTH_SECRET !== 'string' ||
    env.MW1_MEDIA_LAB_AUTH_SECRET.length < 32) reasons.push('WEAK_LAB_AUTH_SECRET');
  for (const key of REQUIRED) if (typeof env[key] !== 'string' ||
    !env[key].trim()) reasons.push('MISSING_LAB_ONLY:' + key);
  return { ok: reasons.length === 0, reasons };
}
module.exports = { validateMediaLabEnv };
