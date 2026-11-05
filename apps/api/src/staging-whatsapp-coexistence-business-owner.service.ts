import { Injectable } from '@nestjs/common';
/**
 * STAGING ONLY: read-only Meta Graph WABA ownership check.
 * Not registered with Nest's AppModule or exposed as an HTTP route.
 *
 * The expected business ID MUST come from a server-owned, independently
 * verified and unexpired MW1 company/onboarding binding (never from the
 * browser). Access to a WABA can be shared with a provider and is not
 * the same as owning it. GET owner_business identifies the actual owner.
 * If Meta does not return explicit owner_business.id, fail closed.
 *
 * Nothing here activates a number, exchanges OAuth, stores a token,
 * imports conversations, subscribes webhooks or sends messages.
 */
export type StagingWhatsappBusinessOwnerReview =
  | {verified:true;wabaId:string;ownerBusinessId:string}
  | {verified:false;reason:
      'staging_only' | 'invalid_input' | 'meta_unavailable'
      | 'owner_unconfirmed' | 'waba_mismatch' | 'owner_mismatch'};

const META_ID=/^[0-9]{6,30}$/;
const STAGING_DB='https://zqfbxqszfnrbwpfukwak.supabase.co';
const MAX_BODY=100000;

function obj(value:unknown):Record<string,unknown>|null{
  return value!==null && typeof value==='object' && !Array.isArray(value)
    ? value as Record<string,unknown>:null;
}

export function reviewWhatsappBusinessOwnerEvidence(
  payload:unknown,
  expectedWabaId:string,
  expectedBusinessId:string,
):StagingWhatsappBusinessOwnerReview{
  if(!META_ID.test(expectedWabaId||'') || !META_ID.test(expectedBusinessId||'')){
    return {verified:false,reason:'invalid_input'};
  }
  const waba=obj(payload);
  if(!waba) return {verified:false,reason:'owner_unconfirmed'};
  if(waba.id!==expectedWabaId) return {verified:false,reason:'waba_mismatch'};
  const ownerId=obj(waba.owner_business)?.id;
  if(typeof ownerId!=='string'||!META_ID.test(ownerId)){
    return {verified:false,reason:'owner_unconfirmed'};
  }
  if(ownerId!==expectedBusinessId){
    return {verified:false,reason:'owner_mismatch'};
  }
  return {verified:true,wabaId:expectedWabaId,ownerBusinessId:ownerId};
}

@Injectable()
export class StagingWhatsappCoexistenceBusinessOwnerService{
  constructor(private readonly request:typeof fetch=fetch){}
  async verify(params:{
    wabaId:string;
    expectedBusinessId:string;
    accessToken:string;
  }):Promise<StagingWhatsappBusinessOwnerReview>{
    if(process.env.MW1_STAGING_MODE!=='true'||
       process.env.SUPABASE_URL?.trim().replace(/\/$/,'')!==STAGING_DB){
      return {verified:false,reason:'staging_only'};
    }
    if(!params || typeof params!=='object' ||
        typeof params.wabaId!=='string'||!META_ID.test(params.wabaId)||
        typeof params.expectedBusinessId!=='string'||
        !META_ID.test(params.expectedBusinessId)||
        typeof params.accessToken!=='string'||
        params.accessToken.length<20 || params.accessToken.length>4096 ||
        /[\r\n\u0000]/.test(params.accessToken)){
      return {verified:false,reason:'invalid_input'};
    }
    const url='https://graph.facebook.com/v26.0/'+params.wabaId+
      '?fields=id%2Cowner_business';
    let data:unknown;
    try{
      const response=await this.request(url,{
        method:'GET',
        headers:{Authorization:'Bearer '+params.accessToken,
          Accept:'application/json'},
        cache:'no-store',
        redirect:'error',
        signal:AbortSignal.timeout(8000),
      });
      if(!response.ok)return {verified:false,reason:'meta_unavailable'};
      const size=response.headers.get('content-length');
      if(size!==null&&(!/^\d+$/.test(size)||Number(size)>MAX_BODY)){
        return {verified:false,reason:'meta_unavailable'};
      }
      const raw=await response.text();
      if(raw.length>MAX_BODY){
        return {verified:false,reason:'meta_unavailable'};
      }
      data=JSON.parse(raw);
    }catch{
      return {verified:false,reason:'meta_unavailable'};
    }
    return reviewWhatsappBusinessOwnerEvidence(
      data,params.wabaId,params.expectedBusinessId);
  }
}
