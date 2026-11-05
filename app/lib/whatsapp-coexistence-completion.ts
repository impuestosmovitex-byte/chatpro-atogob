/**
 * Pure, staging-safe parser for Meta WhatsApp Embedded Signup completion events.
 * This is preparation for a future *separately reviewed* coexistence onboarding
 * route. It is not registered with the running signup flow, does not subscribe
 * webhooks, does not migrate history, and never touches a number or credential.
 *
 * Browser origin filtering is only an initial input check; a real onboarding
 * must also validate the authorization code and WABA/number server-side.
 */
export type WhatsappSignupMode = 'cloud_api' | 'coexistence';
export type WhatsappSignupCompletion = {
  mode: WhatsappSignupMode;
  wabaId: string;
  phoneNumberId: string | null;
  businessId: string | null;
};

const META_HOST = /^(?:facebook\.com|[a-z0-9-]+\.facebook\.com)$/i;
const ASSET_ID = /^[0-9]{6,30}$/;

export function parseWhatsappSignupCompletion(
  origin: unknown,
  raw: unknown,
): WhatsappSignupCompletion | null {
  if (typeof origin !== 'string' || typeof raw !== 'string' ||
      raw.length > 10000) return null;
  let url: URL;
  try { url = new URL(origin); } catch { return null; }
  if (url.protocol !== 'https:' || !META_HOST.test(url.hostname) ||
      url.pathname !== '/' || url.search || url.hash) return null;

  let event: unknown;
  try { event = JSON.parse(raw); } catch { return null; }
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
  const record = event as Record<string, unknown>;
  if (record.type !== 'WA_EMBEDDED_SIGNUP' ||
      !['FINISH', 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'].includes(String(record.event))) {
    return null;
  }
  const data = record.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const values = data as Record<string, unknown>;
  const wabaId = values.waba_id;
  const phoneNumberId = values.phone_number_id;
  const businessId = values.business_id;
  if (typeof wabaId !== 'string' || !ASSET_ID.test(wabaId)) return null;
  if (phoneNumberId != null &&
      (typeof phoneNumberId !== 'string' || !ASSET_ID.test(phoneNumberId))) return null;
  if (businessId != null &&
      (typeof businessId !== 'string' || !ASSET_ID.test(businessId))) return null;
  return {
    mode: record.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING' ?
      'coexistence' : 'cloud_api',
    wabaId,
    phoneNumberId: typeof phoneNumberId === 'string' ? phoneNumberId : null,
    businessId: typeof businessId === 'string' ? businessId : null,
  };
}
