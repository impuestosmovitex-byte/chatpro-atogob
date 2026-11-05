import { StagingWhatsappCoexistencePilotController } from './staging-whatsapp-coexistence-pilot.controller';
import { StagingWhatsappCoexistenceOAuthHandshakeService } from './staging-whatsapp-coexistence-oauth-handshake.service';

describe('Pilot-only WhatsApp coexistence OAuth begin route (staging)',()=>{
  const env=['MW1_STAGING_MODE','SUPABASE_URL','CHATPRO_INBOX_KEY',
    'MW1_STAGING_WHATSAPP_COEXISTENCE_OAUTH_BEGIN_ENABLED',
    'MW1_WHATSAPP_COEXISTENCE_OAUTH_STATE_SECRET',
    'META_WHATSAPP_APP_ID','META_WHATSAPP_EMBEDDED_CONFIG_ID'] as const;
  const saved=new Map<string,string|undefined>();
  const key='SYNTHETIC_INTERNAL_PILOT_TEST_KEY';
  const user='22222222-2222-4222-8222-222222222222';
  const company='11111111-1111-4111-8111-111111111111';
  const slug='piloto-mw1-prueba';
  const nonce='SYNTHETIC_SIGNED_STATE_DOES_NOT_HAVE_META_TOKEN';
  const onboarding='33333333-3333-4333-8333-333333333333';
  const issue=jest.fn();
  let ctrl:StagingWhatsappCoexistencePilotController;

  beforeAll(()=>env.forEach(k=>saved.set(k,process.env[k])));
  afterAll(()=>{for(const [k,v] of saved){
    if(v===undefined)delete process.env[k];else process.env[k]=v;
  }});
  beforeEach(()=>{
    process.env.MW1_STAGING_MODE='true';
    process.env.SUPABASE_URL='https://zqfbxqszfnrbwpfukwak.supabase.co';
    process.env.CHATPRO_INBOX_KEY=key;
    process.env.MW1_STAGING_WHATSAPP_COEXISTENCE_OAUTH_BEGIN_ENABLED='true';
    process.env.MW1_WHATSAPP_COEXISTENCE_OAUTH_STATE_SECRET=
      'UNIT_TEST_NONPRODUCTION_ONLY_SIGNING_KEY_123456789012';
    process.env.META_WHATSAPP_APP_ID='1079916404666757';
    process.env.META_WHATSAPP_EMBEDDED_CONFIG_ID='1431168516739052';
    issue.mockReset().mockResolvedValue({signedState:nonce,onboardingId:onboarding});
    ctrl=new StagingWhatsappCoexistencePilotController(
      {issue} as unknown as StagingWhatsappCoexistenceOAuthHandshakeService);
  });

  it('allows only the staging pilot to inspect readiness',()=>{
    expect(ctrl.readiness(key,user,company,slug)).toEqual({
      ok:true,beginReady:true,metaLaunchEnabled:false,
      codeExchangeEnabled:false,connectionEnabled:false,
      message:expect.any(String),
    });
    expect(issue).not.toHaveBeenCalled();
  });

  it('prepares a nonce for a trusted pilot admin, never a Meta connection',async()=>{
    const value=await ctrl.begin(key,user,company,slug);
    expect(issue).toHaveBeenCalledTimes(1);
    expect(issue).toHaveBeenCalledWith({
      internalKey:key,userId:user,companyId:company,companySlug:slug,
    });
    expect(value).toEqual({
      ok:true,signedState:nonce,onboardingId:onboarding,
      metaLaunchEnabled:false,codeExchangeEnabled:false,connectionEnabled:false,
    });
    expect(JSON.stringify(value)).not.toMatch(/access_token|phone_number_id|webhook/);
  });

  it.each([
    ['wrong key','not-the-key',user,company,slug],
    ['different user format',key,'invalid',company,slug],
    ['different company format',key,user,'invalid',slug],
    ['another tenant',key,user,company,'atogob'],
    ['maogo tenant',key,user,company,'maogo'],
  ])('rejects %s before writing any nonce',async(_,k,u,c,s)=>{
    await expect(ctrl.begin(k,u,c,s)).rejects.toThrow();
    expect(issue).not.toHaveBeenCalled();
  });

  it('does not authorize a disabled staging flag or missing signature key',async()=>{
    process.env.MW1_STAGING_WHATSAPP_COEXISTENCE_OAUTH_BEGIN_ENABLED='false';
    expect(ctrl.readiness(key,user,company,slug).beginReady).toBe(false);
    await expect(ctrl.begin(key,user,company,slug)).rejects.toThrow();
    process.env.MW1_STAGING_WHATSAPP_COEXISTENCE_OAUTH_BEGIN_ENABLED='true';
    delete process.env.MW1_WHATSAPP_COEXISTENCE_OAUTH_STATE_SECRET;
    expect(ctrl.readiness(key,user,company,slug).beginReady).toBe(false);
    await expect(ctrl.begin(key,user,company,slug)).rejects.toThrow();
    expect(issue).not.toHaveBeenCalled();
  });

  it('does not issue a nonce with the wrong Meta configuration',async()=>{
    process.env.META_WHATSAPP_EMBEDDED_CONFIG_ID='123456789012345';
    expect(ctrl.readiness(key,user,company,slug).beginReady).toBe(false);
    await expect(ctrl.begin(key,user,company,slug)).rejects.toThrow();
    expect(issue).not.toHaveBeenCalled();
  });

  it('rejects any production or non-pilot database environment',async()=>{
    process.env.MW1_STAGING_MODE='false';
    await expect(ctrl.begin(key,user,company,slug)).rejects.toThrow();
    process.env.MW1_STAGING_MODE='true';
    process.env.SUPABASE_URL='https://production.supabase.co';
    await expect(ctrl.begin(key,user,company,slug)).rejects.toThrow();
    expect(issue).not.toHaveBeenCalled();
  });

  it('does not leak private Supabase errors or issue connection claims',async()=>{
    issue.mockRejectedValueOnce(Error('SUPABASE_PRIVATE_ROLE_DETAILS'));
    const error=await ctrl.begin(key,user,company,slug).catch(e=>String(e));
    expect(error).not.toContain('SUPABASE_PRIVATE_ROLE_DETAILS');
    expect(issue).toHaveBeenCalledTimes(1);
  });
});
