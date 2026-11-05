import { StagingWhatsappCoexistencePilotController } from './staging-whatsapp-coexistence-pilot.controller';
import { StagingWhatsappCoexistenceOAuthHandshakeService } from './staging-whatsapp-coexistence-oauth-handshake.service';
import { StagingWhatsappCoexistenceMetaCodeExchangeService } from './staging-whatsapp-coexistence-meta-code-exchange.service';
import { StagingWhatsappCoexistenceTenantVerificationService } from './staging-whatsapp-coexistence-tenant-verification.service';

describe('isolated Meta OAuth return (synthetic values only)',()=>{
  const keys=['MW1_STAGING_MODE','SUPABASE_URL','CHATPRO_INBOX_KEY',
    'MW1_STAGING_WHATSAPP_COEXISTENCE_OAUTH_BEGIN_ENABLED',
    'MW1_STAGING_WHATSAPP_COEXISTENCE_META_REVIEW_ENABLED'] as const;
  const saved=new Map<string,string|undefined>();
  const internalKey='SYNTHETIC_MW1_INTERNAL_KEY';
  const userId='11111111-1111-4111-8111-111111111111';
  const companyId='22222222-2222-4222-8222-222222222222';
  const onboardingId='33333333-3333-4333-8333-333333333333';
  const state='SYNTHETIC_SIGNED_COOKIE_STATE_FOR_OFFLINE_TESTS';
  const waba='123456789012345';
  const phone='777777777777777';
  const code='SYNTHETIC_META_EXCHANGE_CODE_12345678901234567890';
  const token='SYNTHETIC_META_ACCESS_TOKEN_12345678901234567890';
  const consume=jest.fn();
  const exchange=jest.fn();
  const resolveSinglePhone=jest.fn();
  const verify=jest.fn();
  let ctl:StagingWhatsappCoexistencePilotController;
  const message=(event='FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
    data:Record<string,unknown>={waba_id:waba,phone_number_id:phone})=>
    JSON.stringify({type:'WA_EMBEDDED_SIGNUP',event,data});
  const input=(metaMessageJson=message())=>({
    signedState:state,trustedHttpOnlyCookieState:state,
    metaMessageOrigin:'https://www.facebook.com',metaMessageJson,
    sdkLoginResponse:{authResponse:{code}},
  });
  const call=(body=input(),slug='piloto-mw1-prueba')=>
    ctl.review(internalKey,userId,companyId,slug,body);
  beforeAll(()=>keys.forEach(k=>saved.set(k,process.env[k])));
  afterAll(()=>{for(const [k,v] of saved){
    if(v===undefined)delete process.env[k];else process.env[k]=v;
  }});
  beforeEach(()=>{
    process.env.MW1_STAGING_MODE='true';
    process.env.SUPABASE_URL='https://zqfbxqszfnrbwpfukwak.supabase.co';
    process.env.CHATPRO_INBOX_KEY=internalKey;
    process.env.MW1_STAGING_WHATSAPP_COEXISTENCE_OAUTH_BEGIN_ENABLED='true';
    process.env.MW1_STAGING_WHATSAPP_COEXISTENCE_META_REVIEW_ENABLED='true';
    consume.mockReset().mockResolvedValue({onboardingId});
    exchange.mockReset().mockResolvedValue(token);
    resolveSinglePhone.mockReset().mockResolvedValue(phone);
    verify.mockReset().mockResolvedValue({readyForLaterProvisioningReview:true});
    ctl=new StagingWhatsappCoexistencePilotController(
      {consume,issue:jest.fn()} as unknown as StagingWhatsappCoexistenceOAuthHandshakeService,
      {exchange,resolveSinglePhone} as unknown as StagingWhatsappCoexistenceMetaCodeExchangeService,
      {verify} as unknown as StagingWhatsappCoexistenceTenantVerificationService,
    );
  });
  it('verifies trusted nonce, Meta evidence and tenant without activation',async()=>{
    const response=await call();
    expect(consume).toHaveBeenCalledWith(
      expect.objectContaining({companySlug:'piloto-mw1-prueba',companyId,userId}),
      state,state,
    );
    expect(exchange).toHaveBeenCalledWith(code);
    expect(verify).toHaveBeenCalledWith(expect.objectContaining({
      companyId,userId,onboardingId,wabaId:waba,phoneNumberId:phone,
      accessToken:token,
    }));
    expect(response).toEqual({
      ok:true,status:'requires_independent_meta_owner_and_phone_review',
      connectionEnabled:false,codeStored:false,
      webhookEnabled:false,historySyncEnabled:false,
    });
    expect(JSON.stringify(response)).not.toContain(token);
    expect(JSON.stringify(response)).not.toContain(code);
  });
  it('resolves a WABA-only event only through checked server lookup',async()=>{
    const result=await call(input(message(
      'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',{waba_id:waba})));
    expect(result.ok).toBe(true);
    expect(resolveSinglePhone).toHaveBeenCalledWith(waba,token);
    expect(verify).toHaveBeenCalledWith(expect.objectContaining({phoneNumberId:phone}));
  });
  it('refuses conventional WhatsApp FINISH without consuming nonce',async()=>{
    const result=await call(input(message('FINISH')));
    expect(result.ok).toBe(false);
    expect(consume).not.toHaveBeenCalled();
    expect(exchange).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });
  it('refuses a disabled Meta reviewer before any OAuth action',async()=>{
    process.env.MW1_STAGING_WHATSAPP_COEXISTENCE_META_REVIEW_ENABLED='false';
    await expect(call()).rejects.toThrow();
    expect(consume).not.toHaveBeenCalled();
    expect(exchange).not.toHaveBeenCalled();
  });
  it('never authorizes other tenants',async()=>{
    await expect(call(input(),'atogob')).rejects.toThrow();
    await expect(call(input(),'maogo')).rejects.toThrow();
    expect(consume).not.toHaveBeenCalled();
    expect(exchange).not.toHaveBeenCalled();
  });
  it('refuses a reused or swapped cookie before code exchange',async()=>{
    consume.mockRejectedValueOnce(Error('nonce already consumed'));
    const result=await call();
    expect(result.ok).toBe(false);
    expect(exchange).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });
  it('does not approve a missing independent business binding',async()=>{
    verify.mockResolvedValueOnce({readyForLaterProvisioningReview:false,
      reason:'business_binding_missing'});
    const result=await call();
    expect(result.ok).toBe(false);
    expect(result.connectionEnabled).toBe(false);
  });
  it('rejects ambiguous WABA-only phone discoveries',async()=>{
    resolveSinglePhone.mockResolvedValueOnce(null);
    const result=await call(input(message(
      'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',{waba_id:waba})));
    expect(result.ok).toBe(false);
    expect(verify).not.toHaveBeenCalled();
  });
});
