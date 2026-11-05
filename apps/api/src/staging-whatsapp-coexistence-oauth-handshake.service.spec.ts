import { createHash } from 'node:crypto';
import { SupabaseService } from './supabase.service';
import {
  issueWhatsappCoexistenceSignedState,
  verifyWhatsappCoexistenceSignedState,
} from './staging-whatsapp-coexistence-oauth-state';
import {
  StagingWhatsappCoexistenceOAuthHandshakeService,
  type WhatsappCoexistenceOAuthActorRequest,
} from './staging-whatsapp-coexistence-oauth-handshake.service';

describe('one-time signed WhatsApp coexistence OAuth, isolated pilot staging',()=>{
  const companyId='11111111-1111-4111-8111-111111111111';
  const userId='22222222-2222-4222-8222-222222222222';
  const actor:WhatsappCoexistenceOAuthActorRequest={
    internalKey:'SYNTHETIC_STAGING_INTERNAL_ONLY',
    companySlug:'piloto-mw1-prueba', companyId,userId,
  };
  const env=['MW1_STAGING_MODE','SUPABASE_URL','CHATPRO_INBOX_KEY',
    'MW1_WHATSAPP_COEXISTENCE_OAUTH_STATE_SECRET'] as const;
  const originals=new Map<string,string|undefined>();
  const insert=jest.fn();
  const rpc=jest.fn();
  const from=jest.fn();
  const getClient=jest.fn();
  let service:StagingWhatsappCoexistenceOAuthHandshakeService;

  function dbTable(name:string) {
    if(name==='mw1_whatsapp_coexistence_oauth_nonces') return {insert};
    const matches:Record<string,unknown>={
      companies:{id:companyId,slug:actor.companySlug,status:'active'},
      company_memberships:{role_id:'33333333-3333-4333-8333-333333333333',active:true},
      app_roles:{key:'owner',company_id:companyId},
    };
    const query:Record<string,jest.Mock>={};
    query.select=jest.fn().mockReturnValue(query);
    query.eq=jest.fn().mockReturnValue(query);
    query.maybeSingle=jest.fn(async()=>({data:matches[name]??null,error:null}));
    return query;
  }
  beforeAll(()=>env.forEach(key=>originals.set(key,process.env[key])));
  afterAll(()=>{
    for(const [key,value] of originals) {
      if(value===undefined)delete process.env[key];
      else process.env[key]=value;
    }
  });
  beforeEach(()=>{
    process.env.MW1_STAGING_MODE='true';
    process.env.SUPABASE_URL='https://zqfbxqszfnrbwpfukwak.supabase.co';
    process.env.CHATPRO_INBOX_KEY=actor.internalKey;
    process.env.MW1_WHATSAPP_COEXISTENCE_OAUTH_STATE_SECRET=
      'SYNTHETIC_64_BYTE_SIGNING_SECRET_ONLY_FOR_UNIT_TESTS_1234567890';
    insert.mockReset().mockResolvedValue({error:null});
    rpc.mockReset().mockResolvedValue({data:true,error:null});
    from.mockReset().mockImplementation(dbTable);
    getClient.mockReset().mockReturnValue({from,rpc});
    service=new StagingWhatsappCoexistenceOAuthHandshakeService(
      {getClient} as unknown as SupabaseService);
  });

  it('issues a purpose-specific signed state and stores ONLY its hash',async()=>{
    const result=await service.issue(actor);
    expect(result.signedState).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(result.onboardingId).toMatch(/^[0-9a-f-]{36}$/);
    expect(from).toHaveBeenCalledWith('mw1_whatsapp_coexistence_oauth_nonces');
    expect(insert).toHaveBeenCalledTimes(1);
    const saved=insert.mock.calls[0][0];
    const digest=createHash('sha256').update(result.signedState).digest('hex');
    expect(saved).toEqual({
      state_hash:digest,company_id:companyId,user_id:userId,
      onboarding_id:result.onboardingId,signup_mode:'coexistence',
      expires_at:expect.any(String),
    });
    const expiry=Date.parse(saved.expires_at);
    expect(expiry).toBeGreaterThan(Date.now()+6*60*1000);
    expect(expiry).toBeLessThanOrEqual(Date.now()+7*60*1000);
    expect(JSON.stringify(saved)).not.toContain(result.signedState);
    expect(JSON.stringify(saved)).not.toContain(process.env.MW1_WHATSAPP_COEXISTENCE_OAUTH_STATE_SECRET);
  });

  it('consumes a signed state with a matching server cookie and owner identity once',async()=>{
    const issued=await service.issue(actor);
    getClient.mockClear();
    const result=await service.consume(actor,issued.signedState,issued.signedState);
    expect(result).toEqual({onboardingId:issued.onboardingId});
    expect(rpc).toHaveBeenCalledWith('mw1_consume_whatsapp_coexistence_oauth_nonce',{
      p_state_hash:createHash('sha256').update(issued.signedState).digest('hex'),
      p_company_id:companyId,p_user_id:userId,p_onboarding_id:issued.onboardingId,
    });
    expect(JSON.stringify(result)).not.toContain(issued.signedState);
    expect(getClient).toHaveBeenCalled();
  });

  it('rejects callback CSRF if secure cookie is absent or mismatched, without DB access',async()=>{
    const first=issueWhatsappCoexistenceSignedState(actor)!;
    const second=issueWhatsappCoexistenceSignedState(actor)!;
    expect(first.state).not.toBe(second.state);
    getClient.mockClear();
    await expect(service.consume(actor,first.state,'')).rejects.toThrow(/inválido/);
    await expect(service.consume(actor,first.state,second.state)).rejects.toThrow(/inválido/);
    expect(getClient).not.toHaveBeenCalled();
  });

  it('rejects a tampered OAuth mode, nonce or signature before DB access',async()=>{
    const issued=issueWhatsappCoexistenceSignedState(actor)!;
    const [payload,sig]=issued.state.split('.');
    const modified=Buffer.from(payload,'base64url').toString('utf8')
      .replace('coexistence','cloud_api');
    const tampered=Buffer.from(modified).toString('base64url')+'.'+sig;
    expect(verifyWhatsappCoexistenceSignedState(actor,tampered,tampered)).toBeNull();
    expect(verifyWhatsappCoexistenceSignedState(actor,issued.state+'X',
      issued.state+'X')).toBeNull();
    expect(verifyWhatsappCoexistenceSignedState({...actor,userId:'44444444-4444-4444-8444-444444444444'},
      issued.state,issued.state)).toBeNull();
    expect(getClient).not.toHaveBeenCalled();
  });

  it('rejects expired and future signed states before nonce consumption',async()=>{
    const now=Date.now();
    const spy=jest.spyOn(Date,'now').mockReturnValue(now);
    try{
      const issued=issueWhatsappCoexistenceSignedState(actor)!;
      spy.mockReturnValue(now+8*60*1000+1);
      expect(verifyWhatsappCoexistenceSignedState(actor,issued.state,issued.state)).toBeNull();
      spy.mockReturnValue(now-1000);
      expect(verifyWhatsappCoexistenceSignedState(actor,issued.state,issued.state)).toBeNull();
    }finally{spy.mockRestore();}
  });

  it('rejects a replay or wrong owner when the atomic database claim fails',async()=>{
    const issued=await service.issue(actor);
    rpc.mockResolvedValueOnce({data:false,error:null});
    await expect(service.consume(actor,issued.signedState,issued.signedState))
      .rejects.toThrow(/ya fue utilizada/);
    rpc.mockResolvedValueOnce({data:'true',error:null});
    await expect(service.consume(actor,issued.signedState,issued.signedState))
      .rejects.toThrow(/ya fue utilizada/);
    rpc.mockResolvedValueOnce({data:null,error:{message:'PRIVATE_ERROR'}});
    const error=await service.consume(actor,issued.signedState,issued.signedState)
      .catch(e=>String(e));
    expect(error).not.toContain('PRIVATE_ERROR');
  });

  it('blocks a different tenant or internal key before DB, state and Meta',async()=>{
    await expect(service.issue({...actor,companySlug:'atogob'}))
      .rejects.toThrow(/piloto/);
    await expect(service.issue({...actor,internalKey:'wrong'}))
      .rejects.toThrow(/interna/);
    expect(getClient).not.toHaveBeenCalled();
  });

  it('blocks other Supabase projects and disabled staging mode',async()=>{
    process.env.MW1_STAGING_MODE='false';
    await expect(service.issue(actor)).rejects.toThrow(/staging/);
    process.env.MW1_STAGING_MODE='true';
    process.env.SUPABASE_URL='https://production.supabase.co';
    await expect(service.issue(actor)).rejects.toThrow(/staging/);
    expect(getClient).not.toHaveBeenCalled();
  });

  it('does not issue a state without its independent signing secret',async()=>{
    delete process.env.MW1_WHATSAPP_COEXISTENCE_OAUTH_STATE_SECRET;
    expect(issueWhatsappCoexistenceSignedState(actor)).toBeNull();
    await expect(service.issue(actor)).rejects.toThrow(/Firma OAuth/);
    expect(insert).not.toHaveBeenCalled();
  });

  it('never claims to exchange, provision or activate a Meta account',()=>{
    for(const method of ['exchangeMetaCode','registerNumber','subscribeWebhook',
      'activateWhatsApp','importHistory','sendMessage','writeBusinessBinding']){
      expect(service).not.toHaveProperty(method);
    }
  });
});
