import { Injectable } from '@nestjs/common';
/**
 * Pilot-only read-only Graph API verifier for future WhatsApp Business App
 * coexistence onboarding. NOT registered with AppModule, any controller or
 * the current Embedded Signup button.
 *
 * An authorized backend caller MUST verify signed user session, company
 * ownership, OAuth code exchange and explicit chosen signup mode first.
 * Passing IDs or a bearer token to this isolated class is not authorization.
 * There is no registration, token persistence, webhook, history import or
 * message send in this module.
 */
export type MetaGraphCoexistenceResult =
  | { verified: true; wabaId: string; phoneNumberId: string }
  | { verified: false; reason:
      'staging_only' | 'invalid_input' | 'meta_unavailable'
      | 'invalid_response' | 'phone_not_in_waba' | 'ambiguous_phone'
      | 'phone_mismatch' | 'not_coexistence' };

type JsonObject = Record<string, unknown>;
type Fetcher = typeof fetch;
const GRAPH_BASE = 'https://graph.facebook.com/v26.0';
const META_ID = /^[0-9]{6,30}$/;
const STAGING_PROJECT = 'https://zqfbxqszfnrbwpfukwak.supabase.co';
const MAX_JSON_CHARS = 200000;

function obj(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject : null;
}

/**
 * The Graph endpoint cannot be controlled by caller supplied URLs.
 * JSON and HTTP failures never expose the token or Meta response body.
 */
@Injectable()
export class StagingWhatsappCoexistenceMetaGraphService {
  constructor(private readonly request: Fetcher = fetch) {}

  private async graphGet(url: string, token: string): Promise<JsonObject | null> {
    try {
      const response = await this.request(url, {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) return null;
      const length = response.headers.get('content-length');
      if (length !== null && (Number(length) > MAX_JSON_CHARS ||
          !Number.isFinite(Number(length)))) return null;
      const body = await response.text();
      if (body.length > MAX_JSON_CHARS) return null;
      return obj(JSON.parse(body));
    } catch {
      return null;
    }
  }

  async verify(params: {
    wabaId: string;
    phoneNumberId: string;
    accessToken: string;
  }): Promise<MetaGraphCoexistenceResult> {
    if (process.env.MW1_STAGING_MODE !== 'true' ||
        process.env.SUPABASE_URL?.trim().replace(/\/$/, '') !== STAGING_PROJECT) {
      return { verified: false, reason: 'staging_only' };
    }
    if (!params || typeof params !== 'object' ||
        typeof params.wabaId !== 'string' || !META_ID.test(params.wabaId) ||
        typeof params.phoneNumberId !== 'string' || !META_ID.test(params.phoneNumberId) ||
        typeof params.accessToken !== 'string' ||
        params.accessToken.length < 20 || params.accessToken.length > 4096 ||
        /[\r\n\u0000]/.test(params.accessToken)) {
      return { verified: false, reason: 'invalid_input' };
    }

    const idListUrl = GRAPH_BASE + '/' + params.wabaId + '/phone_numbers?fields=id&limit=100';
    const phoneUrl = GRAPH_BASE + '/' + params.phoneNumberId +
      '?fields=id%2Cis_on_biz_app%2Cplatform_type';
    // Read-only WABA membership check BEFORE querying the specific number.
    const list = await this.graphGet(idListUrl, params.accessToken);
    if (!list) return { verified: false, reason: 'meta_unavailable' };
    const rows = list.data;
    const paging = obj(list.paging);
    // Do not mistake a paginated result for a complete list.
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > 100 ||
        (paging && typeof paging.next === 'string')) {
      return { verified: false, reason: 'invalid_response' };
    }
    const ids: string[] = [];
    for (const row of rows) {
      const id = obj(row)?.id;
      if (typeof id !== 'string' || !META_ID.test(id)) {
        return { verified: false, reason: 'invalid_response' };
      }
      ids.push(id);
    }
    if (new Set(ids).size !== ids.length) {
      return { verified: false, reason: 'ambiguous_phone' };
    }
    if (!ids.includes(params.phoneNumberId)) {
      return { verified: false, reason: 'phone_not_in_waba' };
    }

    const details = await this.graphGet(phoneUrl, params.accessToken);
    if (!details) return { verified: false, reason: 'meta_unavailable' };
    if (details.id !== params.phoneNumberId) {
      return { verified: false, reason: 'phone_mismatch' };
    }
    if (details.is_on_biz_app !== true ||
        details.platform_type !== 'CLOUD_API') {
      return { verified: false, reason: 'not_coexistence' };
    }
    return {
      verified: true,
      wabaId: params.wabaId,
      phoneNumberId: params.phoneNumberId,
    };
  }
}
