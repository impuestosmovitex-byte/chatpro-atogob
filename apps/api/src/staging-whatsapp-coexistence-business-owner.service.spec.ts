import {
  StagingWhatsappCoexistenceBusinessOwnerService,
  reviewWhatsappBusinessOwnerEvidence,
} from './staging-whatsapp-coexistence-business-owner.service';

describe('Meta WABA owner vs provider access (offline staging)',()=>{
  const wabaId='123456789012345';
  const ownerBusinessId='987654321098765';
  const providerBusinessId='111111111111111';
  const token='SYNTHETIC-UNUSABLE-TOKEN-123456789012345';
  const good={id:wabaId,owner_business:{id:ownerBusinessId,name:'private'}};
  const denied=(reason:string)=>({verified:false,reason});
  const env=['MW1_STAGING_MODE','SUPABASE_URL'] as const;
  const saved=new Map<string,string|undefined>();
  const request=jest.fn();
  let service:StagingWhatsappCoexistenceBusinessOwnerService;
  const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{
    status,headers:{'content-type':'application/json'},
  });
  beforeAll(()=>env.forEach(k=>saved.set(k,process.env[k])));
  afterAll(()=>{
    for(const [k,v] of saved){
      if(v===undefined)delete process.env[k];
      else process.env[k]=v;
    }
  });
  beforeEach(()=>{
    process.env.MW1_STAGING_MODE='true';
    process.env.SUPABASE_URL='https://zqfbxqszfnrbwpfukwak.supabase.co';
    request.mockReset().mockResolvedValue(json(good));
    service=new StagingWhatsappCoexistenceBusinessOwnerService(
      request as typeof fetch);
  });

  it('accepts a WABA explicitly owned by the approved customer portfolio',()=>{
    expect(reviewWhatsappBusinessOwnerEvidence(good,wabaId,ownerBusinessId))
      .toEqual({verified:true,wabaId,ownerBusinessId});
  });

  it.each([
    [null,'owner_unconfirmed'],
    [{id:wabaId},'owner_unconfirmed'],
    [{id:wabaId,owner_business:{name:'no id'}},'owner_unconfirmed'],
    [{id:wabaId,owner_business:providerBusinessId},'owner_unconfirmed'],
    [{id:providerBusinessId,owner_business:{id:ownerBusinessId}},'waba_mismatch'],
    [{id:wabaId,owner_business:{id:providerBusinessId}},'owner_mismatch'],
    [{id:wabaId,owner_business:{id:123456}},'owner_unconfirmed'],
  ])('rejects missing, mismatched or shared-provider ownership (%s)',(payload,reason)=>{
    expect(reviewWhatsappBusinessOwnerEvidence(payload,wabaId,ownerBusinessId))
      .toEqual(denied(reason));
  });

  it('does not infer ownership from shared access to another portfolio',()=>{
    expect(reviewWhatsappBusinessOwnerEvidence({
      id:wabaId,
      owner_business:{id:ownerBusinessId},
      shared_businesses:{data:[{id:providerBusinessId}]},
    },wabaId,providerBusinessId)).toEqual(denied('owner_mismatch'));
  });

  it('only makes a fixed HTTPS read of the selected WABA',async()=>{
    const result=await service.verify({wabaId,expectedBusinessId:ownerBusinessId,
      accessToken:token});
    expect(result).toEqual({verified:true,wabaId,ownerBusinessId});
    expect(request).toHaveBeenCalledTimes(1);
    const [url,options]=request.mock.calls[0] as [string,RequestInit];
    expect(url).toBe('https://graph.facebook.com/v26.0/'+wabaId+
      '?fields=id%2Cowner_business');
    expect(options.method).toBe('GET');
    expect(options.redirect).toBe('error');
    expect(options.cache).toBe('no-store');
    expect(options.headers).toEqual({
      Authorization:'Bearer '+token,Accept:'application/json',
    });
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it.each([
    [{wabaId:'bad',expectedBusinessId:ownerBusinessId,accessToken:token}],
    [{wabaId,expectedBusinessId:'bad',accessToken:token}],
    [{wabaId,expectedBusinessId:ownerBusinessId,accessToken:'short'}],
    [{wabaId,expectedBusinessId:ownerBusinessId,
      accessToken:'SYNTHETIC-BAD\nTOKEN-1234567890'}],
  ])('rejects malformed identifiers and tokens before making a request',async(input)=>{
    await expect(service.verify(input)).resolves.toEqual(denied('invalid_input'));
    expect(request).not.toHaveBeenCalled();
  });

  it('never fetches WABA owner outside exact staging environment',async()=>{
    process.env.MW1_STAGING_MODE='false';
    await expect(service.verify({wabaId,expectedBusinessId:ownerBusinessId,
      accessToken:token})).resolves.toEqual(denied('staging_only'));
    process.env.MW1_STAGING_MODE='true';
    process.env.SUPABASE_URL='https://production.supabase.co';
    await expect(service.verify({wabaId,expectedBusinessId:ownerBusinessId,
      accessToken:token})).resolves.toEqual(denied('staging_only'));
    expect(request).not.toHaveBeenCalled();
  });

  it('denies missing fields, failed Graph calls and private errors',async()=>{
    request.mockResolvedValueOnce(json({id:wabaId}));
    await expect(service.verify({wabaId,expectedBusinessId:ownerBusinessId,
      accessToken:token})).resolves.toEqual(denied('owner_unconfirmed'));
    request.mockRejectedValueOnce(new Error('PRIVATE_TOKEN_IN_ERROR'));
    const result=await service.verify({wabaId,expectedBusinessId:ownerBusinessId,
      accessToken:token});
    expect(result).toEqual(denied('meta_unavailable'));
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_TOKEN/);
    request.mockResolvedValueOnce(json({error:{message:'PRIVATE_META_ERROR'}},403));
    await expect(service.verify({wabaId,expectedBusinessId:ownerBusinessId,
      accessToken:token})).resolves.toEqual(denied('meta_unavailable'));
    request.mockResolvedValueOnce(new Response('malformed'));
    await expect(service.verify({wabaId,expectedBusinessId:ownerBusinessId,
      accessToken:token})).resolves.toEqual(denied('meta_unavailable'));
  });

  it('has no API to provision, send or subscribe messages',()=>{
    for(const method of ['register','activate','sendMessage','subscribeWebhook',
      'exchangeCode','syncHistory','saveToken']){
      expect(service).not.toHaveProperty(method);
    }
  });
});
