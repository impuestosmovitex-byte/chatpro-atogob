import { Injectable } from '@nestjs/common';
import {
  validateMetaCoexistenceCode,
  parseMetaCoexistenceExchangeResponse,
  chooseMetaCoexistencePhone,
} from './staging-whatsapp-coexistence-meta-oauth-evidence';

/** Backend-only, staging-tenant gated read-only Meta OAuth proof. No persistence. */
@Injectable()
export class StagingWhatsappCoexistenceMetaCodeExchangeService {
  constructor(private readonly request:typeof fetch=fetch) {}

  private enabled():boolean {
    return process.env.MW1_STAGING_MODE==='true' &&
      process.env.SUPABASE_URL?.trim().replace(/\/$/,'')===
        'https://zqfbxqszfnrbwpfukwak.supabase.co' &&
      process.env.MW1_STAGING_WHATSAPP_COEXISTENCE_META_REVIEW_ENABLED==='true' &&
      process.env.MW1_STAGING_WHATSAPP_COEXISTENCE_OAUTH_BEGIN_ENABLED==='true' &&
      process.env.META_WHATSAPP_APP_ID?.trim()==='1079916404666757' &&
      process.env.META_WHATSAPP_EMBEDDED_CONFIG_ID?.trim()==='1431168516739052';
  }

  private async graph(url:URL,headers:Record<string,string>={})
    :Promise<Record<string,unknown>|null>{
    if(url.origin!=='https://graph.facebook.com')return null;
    try{
      const response=await this.request(url.toString(),{
        method:'GET',headers:{Accept:'application/json',...headers},
        cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000),
      });
      if(!response.ok)return null;
      const length=response.headers.get('content-length');
      if(length!==null&&(!/^\d+$/.test(length)||Number(length)>100000))return null;
      const raw=await response.text();
      if(raw.length>100000)return null;
      const obj:unknown=JSON.parse(raw);
      return obj&&typeof obj==='object'&&!Array.isArray(obj)
        ? obj as Record<string,unknown>:null;
    }catch{return null;}
  }

  async exchange(code:unknown):Promise<string|null>{
    if(!this.enabled()||!validateMetaCoexistenceCode(code))return null;
    const appSecret=process.env.META_WHATSAPP_APP_SECRET?.trim()||'';
    if(appSecret.length<10||/[\r\n\u0000]/.test(appSecret))return null;
    const url=new URL('https://graph.facebook.com/v26.0/oauth/access_token');
    url.searchParams.set('client_id','1079916404666757');
    url.searchParams.set('client_secret',appSecret);
    url.searchParams.set('code',code as string);
    // Never log the URL, access code, app secret, token or raw Meta response.
    const result=parseMetaCoexistenceExchangeResponse(await this.graph(url));
    return result.ok?result.accessToken:null;
  }

  /** Meta sometimes returns WABA-only metadata; never guess among numbers. */
  async resolveSinglePhone(wabaId:unknown,token:unknown):Promise<string|null>{
    if(!this.enabled()||typeof wabaId!=='string'||!/^\d{6,30}$/.test(wabaId)||
       typeof token!=='string'||token.length<20||token.length>4096||
       /[\r\n\u0000]/.test(token))return null;
    const url=new URL('https://graph.facebook.com/v26.0/'+wabaId+'/phone_numbers');
    url.searchParams.set('fields','id');
    url.searchParams.set('limit','100');
    const rows=await this.graph(url,{Authorization:'Bearer '+token});
    return chooseMetaCoexistencePhone(rows)?.phoneNumberId||null;
  }
}
