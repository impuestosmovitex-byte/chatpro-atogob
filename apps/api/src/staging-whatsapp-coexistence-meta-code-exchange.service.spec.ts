import { StagingWhatsappCoexistenceMetaCodeExchangeService } from './staging-whatsapp-coexistence-meta-code-exchange.service';

describe('server-only WhatsApp Meta OAuth exchange (all mocked)',()=>{
  const keys=[
    'MW1_STAGING_MODE','SUPABASE_URL',
    'MW1_STAGING_WHATSAPP_COEXISTENCE_META_REVIEW_ENABLED',
    'MW1_STAGING_WHATSAPP_COEXISTENCE_OAUTH_BEGIN_ENABLED',
    'META_WHATSAPP_APP_ID','META_WHATSAPP_EMBEDDED_CONFIG_ID',
    'META_WHATSAPP_APP_SECRET',
  ] as const;
  const prior=new Map<string,string|undefined>();
  const code='SYNTHETIC_CODE_FOR_META_STAGING_OFFLINE_12345';
  const token='SYNTHETIC_META_TOKEN_ONLY_FOR_OFFLINE_TESTS_123456789';
  let mocked:jest.Mock;
  let service:StagingWhatsappCoexistenceMetaCodeExchangeService;
  beforeAll(()=>keys.forEach(key=>prior.set(key,process.env[key])));
  afterAll(()=>{for(const [key,value] of prior){
    if(value===undefined)delete process.env[key];else process.env[key]=value;
  }});
  beforeEach(()=>{
    process.env.MW1_STAGING_MODE='true';
    process.env.SUPABASE_URL='https://zqfbxqszfnrbwpfukwak.supabase.co';
    process.env.MW1_STAGING_WHATSAPP_COEXISTENCE_META_REVIEW_ENABLED='true';
    process.env.MW1_STAGING_WHATSAPP_COEXISTENCE_OAUTH_BEGIN_ENABLED='true';
    process.env.META_WHATSAPP_APP_ID='1079916404666757';
    process.env.META_WHATSAPP_EMBEDDED_CONFIG_ID='1431168516739052';
    process.env.META_WHATSAPP_APP_SECRET='SYNTHETIC_APP_SECRET_FOR_TESTS_ONLY';
    mocked=jest.fn().mockResolvedValue(new Response(JSON.stringify({access_token:token}),{
      status:200,headers:{'content-type':'application/json'},
    }));
    service=new StagingWhatsappCoexistenceMetaCodeExchangeService(mocked);
  });
  it('uses only Graph host and never exposes code or token to return callers',async()=>{
    const result=await service.exchange(code);
    expect(result).toBe(token);
    expect(mocked).toHaveBeenCalledTimes(1);
    const [url,options]=mocked.mock.calls[0];
    const parsed=new URL(url as string);
    expect(parsed.origin).toBe('https://graph.facebook.com');
    expect(parsed.pathname).toBe('/v26.0/oauth/access_token');
    expect(parsed.searchParams.get('code')).toBe(code);
    expect(options).toEqual(expect.objectContaining({
      method:'GET',cache:'no-store',redirect:'error',
    }));
  });
  it.each([
    ['pilot flag off','MW1_STAGING_WHATSAPP_COEXISTENCE_META_REVIEW_ENABLED','false'],
    ['begin flag off','MW1_STAGING_WHATSAPP_COEXISTENCE_OAUTH_BEGIN_ENABLED','false'],
    ['not staging','MW1_STAGING_MODE','false'],
    ['production database','SUPABASE_URL','https://production.example.supabase.co'],
    ['wrong configuration','META_WHATSAPP_EMBEDDED_CONFIG_ID','other'],
    ['wrong app','META_WHATSAPP_APP_ID','other'],
  ])('rejects %s without any request',async(_name,key,value)=>{
    process.env[key]=value;
    await expect(service.exchange(code)).resolves.toBeNull();
    expect(mocked).not.toHaveBeenCalled();
  });
  it('rejects invalid Meta code or missing app secret',async()=>{
    await expect(service.exchange('invalid')).resolves.toBeNull();
    delete process.env.META_WHATSAPP_APP_SECRET;
    await expect(service.exchange(code)).resolves.toBeNull();
    expect(mocked).not.toHaveBeenCalled();
  });
  it('never returns response details after an HTTP failure',async()=>{
    mocked.mockResolvedValueOnce(new Response(JSON.stringify({
      error:{message:'PRIVATE_META_PROVIDER_ERROR'},
    }),{status:400}));
    await expect(service.exchange(code)).resolves.toBeNull();
  });
  it('resolves exactly one WABA phone, never any ambiguous selection',async()=>{
    mocked.mockResolvedValueOnce(new Response(JSON.stringify({
      data:[{id:'123456789012345'}],
    }),{status:200}));
    await expect(service.resolveSinglePhone('987654321098765',token))
      .resolves.toBe('123456789012345');
    mocked.mockResolvedValueOnce(new Response(JSON.stringify({
      data:[{id:'123456789012345'},{id:'777777777777777'}],
    }),{status:200}));
    await expect(service.resolveSinglePhone('987654321098765',token))
      .resolves.toBeNull();
  });
  it('does not request Graph for invalid phone or credentials',async()=>{
    await expect(service.resolveSinglePhone('bad',token)).resolves.toBeNull();
    await expect(service.resolveSinglePhone('987654321098765','bad')).resolves.toBeNull();
    expect(mocked).not.toHaveBeenCalled();
  });
});
