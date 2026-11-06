import type {
  StagingWhatsappCoexistenceOAuthHandshakeService,
  WhatsappCoexistenceOAuthActorRequest,
} from './staging-whatsapp-coexistence-oauth-handshake.service';

/**
 * Staging-only, UNREGISTERED preparation of the browser start and Meta
 * Embedded Signup return. Does not open FB.login, register a controller,
 * exchange a code, connect accounts, save credentials or subscribe webhooks.
 *
 * Meta JS SDK supplies the one-time code in the FB.login authResponse and
 * separately posts WA_EMBEDDED_SIGNUP session information via window.message.
 * The session message is a HINT, never proof of WABA/phone ownership.
 *
 * A future independently reviewed web handler MUST authenticate its signed
 * MW1 user session, derive actor values server-side, set an HttpOnly cookie
 * with the issued state, and submit both streams together immediately.
 * Meta's JS SDK is not assumed to echo an OAuth state parameter.
 */
export type WhatsappCoexistenceBrowserStart = {
  status: 'browser_launch_prepared_only';
  onboardingId: string;
  signedState: string;
  cookie: {
    name: '__Host-mw1-wa-coexistence-state';
    value: string;
    httpOnly: true;
    secure: true;
    sameSite: 'lax';
    path: '/';
    maxAge: 420;
  };
};

export type WhatsappCoexistenceMetaCodeHandoff = {
  code: string;
  onboardingId: string;
  wabaIdHint: string;
  phoneNumberIdHint: string | null;
  businessIdHint: string | null;
};
export type WhatsappCoexistenceCodeReview =
  (handoff: WhatsappCoexistenceMetaCodeHandoff) =>
  Promise<{ exchangedAndReviewed: true } | { exchangedAndReviewed: false }>;

export type WhatsappCoexistenceBrowserReturn =
  | { status: 'requires_independent_meta_owner_and_phone_review';
      onboardingId: string; wabaIdHint: string; phoneNumberIdHint: string | null }
  | { status: 'rejected'; reason:
      'wrong_mode' | 'untrusted_meta_event' | 'missing_meta_code'
      | 'exchange_not_configured' | 'state_not_authorized'
      | 'meta_exchange_unconfirmed' };

const ID = /^[0-9]{6,30}$/;
const META_CODE = /^[^\s\u0000-\u001f\u007f]{10,2048}$/;
const META_ORIGINS = new Set([
  'https://www.facebook.com',
  'https://web.facebook.com',
  'https://business.facebook.com',
  'https://facebook.com',
]);
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function idHint(value: unknown): string | null | undefined {
  if (value == null) return null;
  return typeof value === 'string' && ID.test(value) ? value : undefined;
}

/** Do not interpret the browser postMessage as permission to provision. */
export function parseWhatsappCoexistenceMetaSessionHint(
  origin: unknown,
  message: unknown,
): {wabaIdHint: string; phoneNumberIdHint: string | null;
    businessIdHint: string | null} | null {
  if (typeof origin !== 'string' || !META_ORIGINS.has(origin) ||
      typeof message !== 'string' || message.length > 10000) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(message); } catch { return null; }
  const payload = record(parsed);
  const values = record(payload?.data);
  if (!payload || !values || payload.type !== 'WA_EMBEDDED_SIGNUP' ||
      payload.event !== 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING') return null;
  const waba = idHint(values.waba_id);
  const phone = idHint(values.phone_number_id);
  const business = idHint(values.business_id);
  if (typeof waba !== 'string' || phone === undefined ||
      business === undefined) return null;
  return { wabaIdHint: waba, phoneNumberIdHint: phone,
    businessIdHint: business };
}

/** FB.login returns authResponse.code separately from the session message.
 * The code must only be processed by a backend reviewer, never logged or
 * saved in a cookie, URL, analytics or the database. */
export function extractWhatsappCoexistenceSdkCode(response: unknown): string | null {
  const authResponse = record(record(response)?.authResponse);
  const code = authResponse?.code;
  return typeof code === 'string' && META_CODE.test(code) ? code : null;
}

export class StagingWhatsappCoexistenceBrowserHandoffService {
  constructor(
    private readonly handshake: Pick<
      StagingWhatsappCoexistenceOAuthHandshakeService, 'issue' | 'consume'>,
    private readonly review: WhatsappCoexistenceCodeReview | null = null,
  ) {}

  async prepareBrowserStart(
    trustedActor: WhatsappCoexistenceOAuthActorRequest,
  ): Promise<WhatsappCoexistenceBrowserStart> {
    const issued = await this.handshake.issue(trustedActor);
    return {
      status: 'browser_launch_prepared_only',
      onboardingId: issued.onboardingId,
      signedState: issued.signedState,
      cookie: {
        name: '__Host-mw1-wa-coexistence-state',
        value: issued.signedState,
        httpOnly: true, secure: true, sameSite: 'lax',
        path: '/', maxAge: 420,
      },
    };
  }

  async inspectBrowserReturn(input: {
    trustedActor: WhatsappCoexistenceOAuthActorRequest;
    selectedMode: unknown;
    signedState: unknown;
    trustedHttpOnlyCookieState: unknown;
    metaMessageOrigin: unknown;
    metaMessageJson: unknown;
    sdkLoginResponse: unknown;
  }): Promise<WhatsappCoexistenceBrowserReturn> {
    if (input?.selectedMode !== 'coexistence') {
      return { status:'rejected',reason:'wrong_mode' };
    }
    const hint = parseWhatsappCoexistenceMetaSessionHint(
      input.metaMessageOrigin, input.metaMessageJson);
    if (!hint) return {status:'rejected',reason:'untrusted_meta_event'};
    const code = extractWhatsappCoexistenceSdkCode(input.sdkLoginResponse);
    if (!code) return {status:'rejected',reason:'missing_meta_code'};
    // Do not consume a one-time nonce if the future secure Meta exchange
    // dependency is not installed. Nothing is exposed publicly in staging.
    if (!this.review) {
      return {status:'rejected',reason:'exchange_not_configured'};
    }
    if (typeof input.signedState !== 'string' ||
        typeof input.trustedHttpOnlyCookieState !== 'string') {
      return {status:'rejected',reason:'state_not_authorized'};
    }

    let onboardingId: string;
    try {
      const consumed = await this.handshake.consume(
        input.trustedActor, input.signedState,
        input.trustedHttpOnlyCookieState);
      onboardingId = consumed.onboardingId;
    } catch {
      return {status:'rejected',reason:'state_not_authorized'};
    }
    try {
      // The future reviewer MUST exchange the code immediately with Meta,
      // then verify token app, WABA grant, portfolio ownership, actual phone
      // coexistence and consent. No live reviewer is wired at present.
      const reviewed = await this.review({
        code, onboardingId,
        wabaIdHint: hint.wabaIdHint,
        phoneNumberIdHint: hint.phoneNumberIdHint,
        businessIdHint: hint.businessIdHint,
      });
      if (reviewed?.exchangedAndReviewed !== true) {
        return {status:'rejected',reason:'meta_exchange_unconfirmed'};
      }
    } catch {
      return {status:'rejected',reason:'meta_exchange_unconfirmed'};
    }
    // Even a mock 'reviewed' result is NEVER permission to insert a
    // business binding or activate a WhatsApp connection.
    return {
      status:'requires_independent_meta_owner_and_phone_review',
      onboardingId,
      wabaIdHint:hint.wabaIdHint,
      phoneNumberIdHint:hint.phoneNumberIdHint,
    };
  }
}
