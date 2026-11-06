/** Staging-only: strict response validation for future Meta OAuth exchange.
 * No secrets, network calls, subscriptions, phone registrations or writes.
 * A returned code or access token is never proof of WhatsApp coexistence. */
export type MetaCoexistenceOAuthOutcome =
  | { ok: true; accessToken: string }
  | { ok: false; reason: 'invalid_input'|'invalid_response' };

const CODE=/^[^\s\u0000-\u001f\u007f]{20,2048}$/;
const TOKEN=/^[^\r\n\u0000]{20,4096}$/;

export function validateMetaCoexistenceCode(code:unknown):boolean {
  return typeof code==='string' && CODE.test(code);
}

export function parseMetaCoexistenceExchangeResponse(
  payload:unknown,
):MetaCoexistenceOAuthOutcome {
  if(!payload || typeof payload!=='object'||Array.isArray(payload)) {
    return {ok:false,reason:'invalid_response'};
  }
  const token=(payload as Record<string,unknown>).access_token;
  if(typeof token!=='string'||!TOKEN.test(token)) {
    return {ok:false,reason:'invalid_response'};
  }
  return {ok:true,accessToken:token};
}

export function chooseMetaCoexistencePhone(
  payload:unknown,
):{phoneNumberId:string}|null {
  if(!payload||typeof payload!=='object'||Array.isArray(payload))return null;
  const result=payload as Record<string,unknown>;
  const rows=result.data;
  const paging=result.paging;
  if(!Array.isArray(rows)||rows.length!==1||
     (paging&&typeof paging==='object'&&!Array.isArray(paging)&&
       typeof (paging as Record<string,unknown>).next==='string'))return null;
  const first=rows[0];
  if(!first||typeof first!=='object'||Array.isArray(first))return null;
  const id=(first as Record<string,unknown>).id;
  return typeof id==='string'&&/^\d{6,30}$/.test(id)
    ? {phoneNumberId:id}:null;
}
