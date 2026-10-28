import { StagingIntegrationsController } from './staging-integrations.controller';
import { SupabaseService } from './supabase.service';
import { IntegrationCredentialsService } from './integration-credentials.service';

describe('pilot-only Meta OAuth provisioning', () => {
  const before = {
    key:process.env.CHATPRO_INBOX_KEY,
    flag:process.env.MW1_STAGING_WHATSAPP_ONBOARDING_ENABLED,
    appId:process.env.META_WHATSAPP_APP_ID,
    appSecret:process.env.META_WHATSAPP_APP_SECRET,
  };
  let originalFetch: typeof fetch;
  beforeEach(() => {
    process.env.CHATPRO_INBOX_KEY='staging-internal-test-key';
    process.env.MW1_STAGING_WHATSAPP_ONBOARDING_ENABLED='true';
    process.env.META_WHATSAPP_APP_ID='123456789';
    process.env.META_WHATSAPP_APP_SECRET='test-only-app-secret';
    originalFetch=global.fetch;
  });
  afterEach(() => {global.fetch=originalFetch;});
  afterAll(() => {
    for (const [name,value] of Object.entries(before)) {
      const key = {key:'CHATPRO_INBOX_KEY',flag:'MW1_STAGING_WHATSAPP_ONBOARDING_ENABLED',appId:'META_WHATSAPP_APP_ID',appSecret:'META_WHATSAPP_APP_SECRET'}[name as keyof typeof before];
      if(value===undefined) delete process.env[key]; else process.env[key]=value;
    }
  });
  it('encrypts a pilot authorization as pending without subscribing webhooks',async()=>{
    const saved: Array<Record<string,unknown>>=[];
    const rows: Record<string,Record<string,unknown>>={
      companies:{id:'pilot',name:'Pilot',slug:'piloto-mw1-prueba',status:'active'},
      company_memberships:{role_id:'owner',active:true},
      app_roles:{key:'owner',company_id:null},
    };
    const db={from:(table:string)=>{
      const filters:Record<string,unknown>={};
      const q={
        select:(_s:string)=>q,
        eq:(k:string,v:unknown)=>{filters[k]=v;return q;},
        maybeSingle:async()=>({data:rows[table]||null,error:null}),
        limit:async()=>({data:[],error:null}),
        upsert:async(row:Record<string,unknown>)=>{saved.push(row);return {error:null};},
      };
      return q;
    }};
    const endpoints:string[]=[];
    global.fetch=(async(url: string | URL | Request)=>{
      const address=String(url);endpoints.push(address);
      if(address.includes('/oauth/access_token'))
        return {ok:true,json:async()=>({access_token:'test-company-token-very-long'})} as Response;
      if(address.includes('/phone_numbers'))
        return {ok:true,json:async()=>({data:[{id:'123456789',verified_name:'Pilot'}]})} as Response;
      throw Error('Unexpected external request');
    }) as typeof fetch;
    const encrypted = {encrypt:(_value:Record<string,unknown>)=>'ciphertext-only'} as IntegrationCredentialsService;
    const controller=new StagingIntegrationsController({getClient:()=>db} as unknown as SupabaseService,encrypted);
    const result=await controller.embeddedComplete('staging-internal-test-key','user','pilot','piloto-mw1-prueba',
      {code:'code-authorization-long-enough',wabaId:'987654321',phoneNumberId:'123456789'});
    expect(result.status).toBe('pending');
    expect(result.connectionEnabled).toBe(false);
    expect(saved).toHaveLength(1);
    expect(saved[0].credentials_encrypted).toBe('ciphertext-only');
    expect(saved[0].status).toBe('pending');
    expect(endpoints).toHaveLength(2);
    expect(endpoints.every(u=>!u.includes('subscribed_apps'))).toBe(true);
  });
});
