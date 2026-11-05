import {
  reviewMetaTokenEvidence,
  StagingWhatsappCoexistenceMetaTokenReviewService,
} from './staging-whatsapp-coexistence-meta-token-review.service';

describe('Meta WhatsApp token review in staging (offline)',()=>{
  const appId = '123456789012345';
  const wabaId = '987654321098765';
  const otherWabaId = '111111111111111';
  const token = 'MOCK_ONLY_LONG_NO_REAL_ACCESS_TOKEN_01234567890';
  const secret = 'MOCK_ONLY_APPLICATION_SECRET_123456789';
  const now = 1800000000;
  const evidence = () => ({
    data: {
      app_id:appId, is_valid:true, type:'SYSTEM_USER', expires_at:0,
      scopes:['whatsapp_business_management','whatsapp_business_messaging'],
      granular_scopes:[
        {scope:'whatsapp_business_management',target_ids:[wabaId]},
        {scope:'whatsapp_business_messaging',target_ids:[wabaId]},
      ],
    },
  });
  const rejected = (reason:string) => ({reviewed:false,reason});
  const env = ['MW1_STAGING_MODE','SUPABASE_URL','META_WHATSAPP_APP_ID',
    'META_WHATSAPP_APP_SECRET'] as const;
  const originals = new Map<string,string | undefined>();
  const request = jest.fn();
  let service:StagingWhatsappCoexistenceMetaTokenReviewService;
  const response = (data:unknown,status=200) => new Response(JSON.stringify(data),{
    status,headers:{'content-type':'application/json'},
  });

  beforeAll(()=>env.forEach(k=>originals.set(k,process.env[k])));
  afterAll(()=>{
    for(const [name,value] of originals) {
      if(value===undefined) delete process.env[name];
      else process.env[name]=value;
    }
  });
  beforeEach(()=>{
    process.env.MW1_STAGING_MODE='true';
    process.env.SUPABASE_URL='https://zqfbxqszfnrbwpfukwak.supabase.co';
    process.env.META_WHATSAPP_APP_ID=appId;
    process.env.META_WHATSAPP_APP_SECRET=secret;
    request.mockReset().mockResolvedValue(response(evidence()));
    service = new StagingWhatsappCoexistenceMetaTokenReviewService(
      request as typeof fetch);
  });

  it('accepts only correct app, valid system token, scopes and explicit WABA grant',()=>{
    expect(reviewMetaTokenEvidence(evidence(),appId,wabaId,now))
      .toEqual({reviewed:true,appId,wabaId});
  });

  it.each([
    [null,'invalid_token'],
    [{data:{...evidence().data,is_valid:false}},'invalid_token'],
    [{data:{...evidence().data,app_id:otherWabaId}},'wrong_app'],
    [{data:{...evidence().data,type:'USER'}},'invalid_token'],
    [{data:{...evidence().data,expires_at:now-1}},'expired'],
    [{data:{...evidence().data,data_access_expires_at:now}},'expired'],
    [{data:{...evidence().data,expires_at:'0'}},'expired'],
    [{data:{...evidence().data,scopes:['whatsapp_business_management']}},'permissions_missing'],
    [{data:{...evidence().data,scopes:[]}},'permissions_missing'],
    [{data:{...evidence().data,granular_scopes:[]}},'waba_grant_unconfirmed'],
    [{data:{...evidence().data,granular_scopes:[
      {scope:'whatsapp_business_management'}]}},'waba_grant_unconfirmed'],
    [{data:{...evidence().data,granular_scopes:[
      {scope:'whatsapp_business_management',target_ids:[otherWabaId]}]}},'waba_grant_unconfirmed'],
    [{data:{...evidence().data,granular_scopes:[
      {scope:'whatsapp_business_management',target_ids:[wabaId,wabaId]}]}},'waba_grant_unconfirmed'],
    [{data:{...evidence().data,granular_scopes:[
      {scope:'whatsapp_business_management',target_ids:[wabaId]},
      {scope:'whatsapp_business_management',target_ids:[wabaId]}]}},'waba_grant_unconfirmed'],
  ])('fails closed on invalid token evidence (%s)',(payload,reason)=>{
    expect(reviewMetaTokenEvidence(payload,appId,wabaId,now)).toEqual(rejected(reason));
  });

  it('accepts token with known unexpired timestamps',()=>{
    const proof=evidence();
    proof.data.expires_at=now+5000;
    expect(reviewMetaTokenEvidence(proof,appId,wabaId,now))
      .toEqual({reviewed:true,appId,wabaId});
  });

  it('consults only the fixed HTTPS Meta introspection endpoint and hides token',async()=>{
    await expect(service.review(token,wabaId)).resolves.toEqual({
      reviewed:true,appId,wabaId,
    });
    expect(request).toHaveBeenCalledTimes(1);
    const [url,options]=request.mock.calls[0] as [string,RequestInit];
    const parsed=new URL(url);
    expect(parsed.origin).toBe('https://graph.facebook.com');
    expect(parsed.pathname).toBe('/v26.0/debug_token');
    expect(parsed.searchParams.get('input_token')).toBe(token);
    expect(options.method).toBe('GET');
    expect(options.redirect).toBe('error');
    expect(options.cache).toBe('no-store');
    expect(options.headers).toEqual({
      Authorization:'Bearer ' + appId + '|' + secret,
      Accept:'application/json',
    });
    expect(JSON.stringify(await service.review(token,wabaId)))
      .not.toMatch(/MOCK_ONLY|access_token|app_secret/);
  });

  it('blocks production or another Supabase project before contacting Meta',async()=>{
    process.env.MW1_STAGING_MODE='false';
    await expect(service.review(token,wabaId)).resolves.toEqual(rejected('staging_only'));
    process.env.MW1_STAGING_MODE='true';
    process.env.SUPABASE_URL='https://another.supabase.co';
    await expect(service.review(token,wabaId)).resolves.toEqual(rejected('staging_only'));
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    ['bad-token','invalid_input'],
    ['1234','invalid_input'],
    ['line\r\nTOKEN_01234567890123456789','invalid_input'],
  ])('rejects malformed tokens before network (%s)',async (value,reason)=>{
    await expect(service.review(value,wabaId)).resolves.toEqual(rejected(reason));
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects invalid app configuration and WABA before network',async()=>{
    await expect(service.review(token,'bad')).resolves.toEqual(rejected('invalid_input'));
    delete process.env.META_WHATSAPP_APP_SECRET;
    await expect(service.review(token,wabaId)).resolves.toEqual(rejected('invalid_input'));
    expect(request).not.toHaveBeenCalled();
  });

  it('does not leak upstream errors or accept failed HTTP responses',async()=>{
    request.mockReset().mockResolvedValue(response({error:{message:'PRIVATE_META_SECRET'}},401));
    await expect(service.review(token,wabaId)).resolves.toEqual(rejected('meta_unavailable'));
    request.mockReset().mockRejectedValue(Error('PRIVATE_TOKEN_ERROR'));
    const failure=await service.review(token,wabaId);
    expect(failure).toEqual(rejected('meta_unavailable'));
    expect(JSON.stringify(failure)).not.toMatch(/PRIVATE_|MOCK_ONLY/);
    request.mockReset().mockResolvedValue(new Response('INVALID_JSON'));
    await expect(service.review(token,wabaId)).resolves.toEqual(rejected('meta_unavailable'));
    request.mockReset().mockResolvedValue(new Response('{}',{
      headers:{'content-length':'200000'},
    }));
    await expect(service.review(token,wabaId)).resolves.toEqual(rejected('meta_unavailable'));
  });

  it('never grants a WABA lacking a scoped target even if global scopes exist',async()=>{
    const absent=evidence();
    absent.data.granular_scopes=[];
    request.mockResolvedValueOnce(response(absent));
    await expect(service.review(token,wabaId)).resolves.toEqual(rejected('waba_grant_unconfirmed'));
  });

  it('exposes no registration or authorization exchange methods',()=>{
    for (const forbidden of ['exchangeCode','registerNumber','activate',
      'syncHistory','sendMessage','subscribeWebhook','saveToken']) {
      expect(service).not.toHaveProperty(forbidden);
    }
  });
});
