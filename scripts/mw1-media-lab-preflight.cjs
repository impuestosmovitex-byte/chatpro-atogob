'use strict';
/**
 * Never use production/staging deployment variables to start the media lab.
 * Pure configuration preflight (no network calls, no secrets printed).
 * This file is NOT a server or a deployment recipe.
 */
const FORBIDDEN = [
  'CHATPRO_INBOX_KEY', 'CHATPRO_API_URL', 'DATABASE_URL',
  'META_WHATSAPP_APP_SECRET', 'META_INSTAGRAM_APP_SECRET',
  'META_MESSENGER_WEBHOOK_VERIFY_TOKEN', 'WHATSAPP_ACCESS_TOKEN',
  'SHOPIFY_ACCESS_TOKEN', 'REDIS_URL',
  'STRIPE_SECRET_KEY', 'MERCADOPAGO_ACCESS_TOKEN',
];
const REQUIRED = [
  'MW1_MEDIA_LAB_DATASET_ID',
  'MW1_MEDIA_LAB_PROJECT_ID',
  'MW1_MEDIA_LAB_AUTH_SECRET',
  'MW1_MEDIA_LAB_STORAGE_BUCKET',
];
const BLOCKED_PROJECT_IDS = new Set([
  // Known staging project: prevent accidental connection, no secrets stored.
  'zqfbxqszfnrbwpfukwak',
]);
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
  for (const key of REQUIRED) if (typeof env[key] !== 'string' ||
    !env[key].trim()) reasons.push('MISSING_LAB_ONLY:' + key);
  const url = env.SUPABASE_URL;
  if (typeof url !== 'string') {
    reasons.push('LAB_DATABASE_REQUIRED');
  } else {
    let parsed;
    try { parsed = new URL(url); } catch { /* invalid URL */ }
    const host = parsed?.hostname.toLowerCase();
    const projectId = host?.endsWith('.supabase.co')
      ? host.slice(0, -'.supabase.co'.length) : '';
    if (!parsed || parsed.protocol !== 'https:' || !projectId ||
      BLOCKED_PROJECT_IDS.has(projectId) ||
      projectId !== env.MW1_MEDIA_LAB_PROJECT_ID) {
      reasons.push('LAB_DATABASE_PROJECT_NOT_ISOLATED');
    }
  }
  return { ok: reasons.length === 0, reasons };
}
module.exports = { validateMediaLabEnv };
