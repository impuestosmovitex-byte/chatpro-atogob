/**
 * Isolated STAGING-only review of Meta's OAuth token introspection.
 * NOT registered in Nest AppModule, controllers, queues or signup flows.
 *
 * A future controller must first authenticate a signed pilot session and
 * exchange a fresh OAuth code on the server. This service checks whether
 * the resulting Meta token is valid, issued for the configured WhatsApp
 * app and granted WhatsApp management/messaging scopes for the selected WABA.
 * Even a successful review is NOT proof of ownership by an MW1 tenant:
 * compare the Meta business portfolio from an independently verified
 * authorization and the pilot's saved business binding before provisioning.
 *
 * Never persist, log or return app secrets or user tokens here.
 */
export type WhatsappMetaTokenReview =
  | { reviewed: true; wabaId: string; appId: string }
  | { reviewed: false; reason:
      'staging_only' | 'invalid_input' | 'meta_unavailable'
      | 'invalid_token' | 'wrong_app' | 'expired'
      | 'permissions_missing' | 'waba_grant_unconfirmed' };

const STAGING_DB = 'https://zqfbxqszfnrbwpfukwak.supabase.co';
const META_ID = /^[0-9]{6,30}$/;
const ALLOWED_TOKEN = /^[^\r\n\u0000]+$/;
const GRAPH_ENDPOINT = 'https://graph.facebook.com/v26.0/debug_token';
const MAX_BODY = 100000;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** A positive result requires explicit WABA grant; missing targets
 * return waba_grant_unconfirmed rather than claiming tenant ownership. */
export function reviewMetaTokenEvidence(
  payload: unknown,
  appId: string,
  wabaId: string,
  nowSeconds: number,
): WhatsappMetaTokenReview {
  if (!META_ID.test(appId) || !META_ID.test(wabaId) ||
      !Number.isSafeInteger(nowSeconds) || nowSeconds <= 0) {
    return { reviewed:false, reason:'invalid_input' };
  }
  const data = record(record(payload)?.data);
  if (!data || data.is_valid !== true) {
    return { reviewed:false, reason:'invalid_token' };
  }
  if (data.app_id !== appId) {
    return { reviewed:false, reason:'wrong_app' };
  }
  // Embedded Signup v4 uses a Business Integration System User token.
  if (data.type !== 'SYSTEM_USER') {
    return { reviewed:false, reason:'invalid_token' };
  }
  for (const property of ['expires_at','data_access_expires_at']) {
    const expiry = data[property];
    if (expiry != null && (!Number.isSafeInteger(expiry) ||
        typeof expiry !== 'number' || expiry < 0 ||
        (expiry > 0 && expiry <= nowSeconds))) {
      return { reviewed:false, reason:'expired' };
    }
  }
  if (!Array.isArray(data.scopes) ||
      !data.scopes.includes('whatsapp_business_management') ||
      !data.scopes.includes('whatsapp_business_messaging')) {
    return { reviewed:false, reason:'permissions_missing' };
  }

  const granular = data.granular_scopes;
  if (!Array.isArray(granular)) {
    return { reviewed:false, reason:'waba_grant_unconfirmed' };
  }
  const scoped = granular.filter(x =>
    record(x)?.scope === 'whatsapp_business_management');
  if (scoped.length !== 1) {
    return { reviewed:false, reason:'waba_grant_unconfirmed' };
  }
  const ids = record(scoped[0])?.target_ids;
  if (!Array.isArray(ids) || ids.length === 0 ||
      ids.some((id:unknown) => typeof id !== 'string' || !META_ID.test(id)) ||
      new Set(ids).size !== ids.length || !ids.includes(wabaId)) {
    return { reviewed:false, reason:'waba_grant_unconfirmed' };
  }
  return {reviewed:true,appId,wabaId};
}

export class StagingWhatsappCoexistenceMetaTokenReviewService {
  constructor(private readonly request: typeof fetch = fetch) {}

  async review(token: string, wabaId: string): Promise<WhatsappMetaTokenReview> {
    if (process.env.MW1_STAGING_MODE !== 'true' ||
        process.env.SUPABASE_URL?.trim().replace(/\/$/, '') !== STAGING_DB) {
      return {reviewed:false,reason:'staging_only'};
    }
    const appId = process.env.META_WHATSAPP_APP_ID?.trim() || '';
    const appSecret = process.env.META_WHATSAPP_APP_SECRET?.trim() || '';
    if (!META_ID.test(appId) || !META_ID.test(wabaId) ||
        appSecret.length < 10 || typeof token !== 'string' ||
        token.length < 20 || token.length > 4096 ||
        !ALLOWED_TOKEN.test(token) || !ALLOWED_TOKEN.test(appSecret)) {
      return {reviewed:false,reason:'invalid_input'};
    }
    // Meta documents GET /debug_token?input_token=... with app access token.
    // The only possible destination is the fixed Graph API host; no redirects.
    const url = new URL(GRAPH_ENDPOINT);
    url.searchParams.set('input_token',token);
    let payload: unknown;
    try {
      const response = await this.request(url.toString(),{
        method:'GET',
        headers:{Authorization:'Bearer ' + appId + '|' + appSecret,
          Accept:'application/json'},
        redirect:'error',
        cache:'no-store',
        signal:AbortSignal.timeout(8000),
      });
      if (!response.ok) return {reviewed:false,reason:'meta_unavailable'};
      const length = response.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) ||
          Number(length) > MAX_BODY)) {
        return {reviewed:false,reason:'meta_unavailable'};
      }
      const body = await response.text();
      if (body.length > MAX_BODY) {
        return {reviewed:false,reason:'meta_unavailable'};
      }
      payload = JSON.parse(body);
    } catch {
      return {reviewed:false,reason:'meta_unavailable'};
    }
    return reviewMetaTokenEvidence(
      payload,appId,wabaId,Math.floor(Date.now()/1000));
  }
}
