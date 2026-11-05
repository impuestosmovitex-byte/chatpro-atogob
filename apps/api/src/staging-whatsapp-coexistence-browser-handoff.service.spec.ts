import {
  issueWhatsappCoexistenceSignedState,
  verifyWhatsappCoexistenceSignedState,
} from './staging-whatsapp-coexistence-oauth-state';
import {
  parseWhatsappCoexistenceMetaSessionHint,
  extractWhatsappCoexistenceSdkCode,
  StagingWhatsappCoexistenceBrowserHandoffService,
} from './staging-whatsapp-coexistence-browser-handoff.service';

describe('isolated browser-to-server Meta coexistence signup return (offline)', () => {
  const actor = {
    internalKey: 'SYNTHETIC_INTERNAL_KEY_FOR_TESTS',
    companyId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    companySlug: 'piloto-mw1-prueba',
  };
  const waba = '123456789012345';
  const phone = '987654321098765';
  const metaBusiness = '555555555555555';
  const code = 'AQ_SYNTHETIC_META_ONE_TIME_CODE_NO_REAL_ACCESS_123456789';
  const message = (event='FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
    data: Record<string, unknown>={waba_id:waba, phone_number_id:phone,
      business_id:metaBusiness}) => JSON.stringify({
        type:'WA_EMBEDDED_SIGNUP', event, data,
      });
  const env=['MW1_STAGING_MODE','SUPABASE_URL',
    'MW1_WHATSAPP_COEXISTENCE_OAUTH_STATE_SECRET'] as const;
  const previous=new Map<string,string|undefined>();
  const issue=jest.fn();
  const consume=jest.fn();
  const review=jest.fn();
  let service:StagingWhatsappCoexistenceBrowserHandoffService;
  let signedState:string;
  let onboardingId:string;

  const makeInput=() => ({
    trustedActor:actor,selectedMode:'coexistence',
    signedState,
    trustedHttpOnlyCookieState:signedState,
    metaMessageOrigin:'https://www.facebook.com',
    metaMessageJson:message(),
    sdkLoginResponse:{status:'connected',authResponse:{code}},
  });

  beforeAll(()=>env.forEach(name=>previous.set(name,process.env[name])));
  afterAll(()=>{
    for(const [name,value] of previous){
      if(value===undefined)delete process.env[name];
      else process.env[name]=value;
    }
  });
  beforeEach(()=>{
    process.env.MW1_STAGING_MODE='true';
    process.env.SUPABASE_URL='https://zqfbxqszfnrbwpfukwak.supabase.co';
    process.env.MW1_WHATSAPP_COEXISTENCE_OAUTH_STATE_SECRET=
      'SYNTHETIC_DEDICATED_SIGNING_KEY_FOR_TESTS_ONLY_123456789012345';
    const signed=issueWhatsappCoexistenceSignedState(actor)!;
    signedState=signed.state;
    onboardingId=signed.onboardingId;
    issue.mockReset().mockResolvedValue({
      signedState,onboardingId,
    });
    let alreadyUsed=false;
    consume.mockReset().mockImplementation(async (requestedActor,rawState,cookie)=>{
      const verified=verifyWhatsappCoexistenceSignedState(requestedActor,rawState,cookie);
      if(!verified || alreadyUsed) throw Error('used or invalid state');
      alreadyUsed=true;
      return {onboardingId:verified.onboardingId};
    });
    review.mockReset().mockResolvedValue({exchangedAndReviewed:true});
    const handshake = { issue, consume } as unknown as
      ConstructorParameters<typeof StagingWhatsappCoexistenceBrowserHandoffService>[0];
    service=new StagingWhatsappCoexistenceBrowserHandoffService(
      handshake,review);
  });

  it('prepares a host-only Secure HttpOnly cookie with the signed pilot state',async()=>{
    const start=await service.prepareBrowserStart(actor);
    expect(issue).toHaveBeenCalledWith(actor);
    expect(start).toEqual({
      status:'browser_launch_prepared_only',
      onboardingId,signedState,
      cookie:{
        name:'__Host-mw1-wa-coexistence-state',value:signedState,
        httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:420,
      },
    });
    expect(JSON.stringify(start)).not.toContain(code);
    expect(consume).not.toHaveBeenCalled();
    expect(review).not.toHaveBeenCalled();
  });

  it('recognizes the SDK code and Meta completion as TWO different sources',async()=>{
    expect(extractWhatsappCoexistenceSdkCode({authResponse:{code}})).toBe(code);
    expect(parseWhatsappCoexistenceMetaSessionHint(
      'https://www.facebook.com',message())).toEqual({
        wabaIdHint:waba,phoneNumberIdHint:phone,businessIdHint:metaBusiness,
      });
    const result=await service.inspectBrowserReturn(makeInput());
    expect(consume).toHaveBeenCalledTimes(1);
    expect(consume).toHaveBeenCalledWith(actor,signedState,signedState);
    expect(review).toHaveBeenCalledWith({
      code,onboardingId,wabaIdHint:waba,phoneNumberIdHint:phone,
      businessIdHint:metaBusiness,
    });
    expect(result).toEqual({
      status:'requires_independent_meta_owner_and_phone_review',
      onboardingId,wabaIdHint:waba,phoneNumberIdHint:phone,
    });
    expect(JSON.stringify(result)).not.toContain(code);
    expect(JSON.stringify(result)).not.toContain(metaBusiness);
  });

  it('allows WABA-only coexistence FINISH but never guesses a phone',async()=>{
    const result=await service.inspectBrowserReturn({
      ...makeInput(),metaMessageJson:message(
        'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',{waba_id:waba}),
    });
    expect(result).toEqual({
      status:'requires_independent_meta_owner_and_phone_review',
      onboardingId,wabaIdHint:waba,phoneNumberIdHint:null,
    });
    expect(review.mock.calls[0][0].phoneNumberIdHint).toBeNull();
  });

  it.each([
    ['conventional signup','FINISH'],
    ['cancelled flow','CANCEL'],
    ['unrelated event','FINISH_GRANT_ONLY_API_ACCESS'],
  ])('rejects %s before touching one-time state',async(_,event)=>{
    const result=await service.inspectBrowserReturn({
      ...makeInput(),metaMessageJson:message(event),
    });
    expect(result).toEqual({status:'rejected',reason:'untrusted_meta_event'});
    expect(consume).not.toHaveBeenCalled();
    expect(review).not.toHaveBeenCalled();
  });

  it.each([
    ['another origin','https://evil.example.com'],
    ['plain HTTP','http://www.facebook.com'],
    ['attacker subdomain','https://www.facebook.com.evil.example.com'],
    ['wrong port','https://www.facebook.com:8443'],
  ])('rejects %s as a Meta session message',async(_,origin)=>{
    const result=await service.inspectBrowserReturn({
      ...makeInput(),metaMessageOrigin:origin,
    });
    expect(result).toEqual({status:'rejected',reason:'untrusted_meta_event'});
    expect(consume).not.toHaveBeenCalled();
    expect(review).not.toHaveBeenCalled();
  });

  it.each([
    [JSON.stringify({type:'OTHER',event:'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',data:{waba_id:waba}})],
    [message('FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',{waba_id:'wrong'})],
    [message('FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',{waba_id:waba,phone_number_id:'fake'})],
    ['invalid json'],
  ])('rejects malformed or non-coexistence event before state is consumed',async(payload)=>{
    const result=await service.inspectBrowserReturn({...makeInput(),
      metaMessageJson:payload});
    expect(result).toEqual({status:'rejected',reason:'untrusted_meta_event'});
    expect(consume).not.toHaveBeenCalled();
    expect(review).not.toHaveBeenCalled();
  });

  it('rejects a conventional signup mode before reading a Meta code',async()=>{
    const result=await service.inspectBrowserReturn({
      ...makeInput(),selectedMode:'cloud_api',
    });
    expect(result).toEqual({status:'rejected',reason:'wrong_mode'});
    expect(consume).not.toHaveBeenCalled();
  });

  it.each([
    [{status:'connected'}],
    [{authResponse:{accessToken:'FAKE_TOKEN_ONLY'}}],
    [{authResponse:{code:'short'}}],
    [{authResponse:{code:'bad\ncode'.repeat(10)}}],
    [{authResponse:{code:'A'.repeat(2500)}}],
    [null],
  ])('does not mistake invalid or missing SDK code for success',async(sdkLoginResponse)=>{
    const result=await service.inspectBrowserReturn({
      ...makeInput(),sdkLoginResponse,
    });
    expect(result).toEqual({status:'rejected',reason:'missing_meta_code'});
    expect(consume).not.toHaveBeenCalled();
    expect(review).not.toHaveBeenCalled();
  });

  it('requires a separate approved server-only code exchange reviewer',async()=>{
    const handshake={issue,consume} as unknown as
      ConstructorParameters<typeof StagingWhatsappCoexistenceBrowserHandoffService>[0];
    const disabled=new StagingWhatsappCoexistenceBrowserHandoffService(handshake);
    await expect(disabled.inspectBrowserReturn(makeInput())).resolves.toEqual({
      status:'rejected',reason:'exchange_not_configured',
    });
    expect(consume).not.toHaveBeenCalled();
  });

  it('rejects missing and mismatched HttpOnly cookie state',async()=>{
    for(const cookie of ['',undefined,'some-other-state']) {
      const res=await service.inspectBrowserReturn({
        ...makeInput(),trustedHttpOnlyCookieState:cookie,
      });
      expect(res).toEqual({status:'rejected',reason:'state_not_authorized'});
    }
    expect(review).not.toHaveBeenCalled();
  });

  it('rejects a swapped actor even when the browser submits a valid code',async()=>{
    const res=await service.inspectBrowserReturn({
      ...makeInput(),trustedActor:{...actor,userId:
        '33333333-3333-4333-8333-333333333333'},
    });
    expect(res).toEqual({status:'rejected',reason:'state_not_authorized'});
    expect(review).not.toHaveBeenCalled();
  });

  it('rejects a replay of a formerly consumed callback state',async()=>{
    const first=await service.inspectBrowserReturn(makeInput());
    expect(first.status).toBe('requires_independent_meta_owner_and_phone_review');
    const second=await service.inspectBrowserReturn(makeInput());
    expect(second).toEqual({status:'rejected',reason:'state_not_authorized'});
    expect(review).toHaveBeenCalledTimes(1);
  });

  it('never returns a connection claim on reviewer failure or private exceptions',async()=>{
    review.mockResolvedValueOnce({exchangedAndReviewed:false});
    await expect(service.inspectBrowserReturn(makeInput())).resolves.toEqual({
      status:'rejected',reason:'meta_exchange_unconfirmed',
    });
    const next=issueWhatsappCoexistenceSignedState(actor)!;
    signedState=next.state;
    onboardingId=next.onboardingId;
    review.mockRejectedValueOnce(Error('PRIVATE_META_ACCESS_TOKEN'));
    const result=await service.inspectBrowserReturn(makeInput());
    expect(result).toEqual({status:'rejected',reason:'meta_exchange_unconfirmed'});
    expect(JSON.stringify(result)).not.toContain('PRIVATE_META_ACCESS_TOKEN');
  });

  it('never exposes code exchange, registration or webhook methods',()=>{
    for(const action of ['exchangeMetaCode','registerNumber','activateWhatsApp',
      'subscribeWebhook','sendMessage','syncHistory','writeBusinessBinding']){
      expect(service).not.toHaveProperty(action);
    }
  });
});
