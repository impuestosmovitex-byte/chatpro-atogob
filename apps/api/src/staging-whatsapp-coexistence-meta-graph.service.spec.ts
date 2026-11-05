import {
  StagingWhatsappCoexistenceMetaGraphService,
} from './staging-whatsapp-coexistence-meta-graph.service';

describe('staging-only Meta Graph coexistence phone lookup (offline)', () => {
  const env = ['MW1_STAGING_MODE', 'SUPABASE_URL'] as const;
  const original = new Map<string, string | undefined>();
  const wabaId = '123456789012345';
  const phoneNumberId = '987654321098765';
  const token = 'SYNTHETIC_TEST_TOKEN_ONLY_1234567890';
  const input = { wabaId, phoneNumberId, accessToken: token };
  const request = jest.fn();
  let verifier: StagingWhatsappCoexistenceMetaGraphService;

  function json(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }
  beforeAll(() => {
    for (const k of env) original.set(k, process.env[k]);
  });
  beforeEach(() => {
    process.env.MW1_STAGING_MODE = 'true';
    process.env.SUPABASE_URL = 'https://zqfbxqszfnrbwpfukwak.supabase.co';
    request.mockReset()
      .mockResolvedValueOnce(json({data:[{id:phoneNumberId}]}))
      .mockResolvedValueOnce(json({
        id:phoneNumberId,is_on_biz_app:true,platform_type:'CLOUD_API',
      }));
    verifier = new StagingWhatsappCoexistenceMetaGraphService(request as typeof fetch);
  });
  afterAll(() => {
    for (const [key,value] of original) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('checks WABA membership before verifying true Meta coexistence, with no writes', async () => {
    await expect(verifier.verify(input)).resolves.toEqual({
      verified:true,wabaId,phoneNumberId,
    });
    expect(request).toHaveBeenCalledTimes(2);
    const [firstUrl,firstOptions] = request.mock.calls[0] as [string,RequestInit];
    const [secondUrl,secondOptions] = request.mock.calls[1] as [string,RequestInit];
    expect(firstUrl).toBe(
      'https://graph.facebook.com/v26.0/' + wabaId + '/phone_numbers?fields=id&limit=100',
    );
    expect(secondUrl).toBe(
      'https://graph.facebook.com/v26.0/' + phoneNumberId +
      '?fields=id%2Cis_on_biz_app%2Cplatform_type',
    );
    for (const options of [firstOptions,secondOptions]) {
      expect(options.method).toBe('GET');
      expect(options.cache).toBe('no-store');
      expect(options.redirect).toBe('error');
      expect((options.headers as Record<string,string>).Authorization).toBe('Bearer ' + token);
    }
    expect(JSON.stringify(await verifier.verify({
      ...input,accessToken:token,
    }))).not.toContain(token);
  });

  it('never performs requests outside the exact Supabase staging project or mode', async () => {
    process.env.MW1_STAGING_MODE = 'false';
    await expect(verifier.verify(input)).resolves.toEqual({
      verified:false,reason:'staging_only',
    });
    process.env.MW1_STAGING_MODE = 'true';
    process.env.SUPABASE_URL = 'https://production-project.supabase.co';
    await expect(verifier.verify(input)).resolves.toEqual({
      verified:false,reason:'staging_only',
    });
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    [{...input,wabaId:'not-a-number'}],
    [{...input,phoneNumberId:'some-number'}],
    [{...input,accessToken:'short'}],
    [{...input,accessToken:'long-token-with-newline\n'.repeat(3)}],
    [{...input,accessToken:''}],
  ])('rejects malformed credentials or identifiers without hitting Meta', async (data) => {
    await expect(verifier.verify(data)).resolves.toEqual({
      verified:false,reason:'invalid_input',
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('does not consult phone details if the WABA phone list excludes the number', async () => {
    request.mockReset().mockResolvedValueOnce(json({data:[{id:'111111111111111'}]}));
    await expect(verifier.verify(input)).resolves.toEqual({
      verified:false,reason:'phone_not_in_waba',
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{data:[{id:phoneNumberId},{id:phoneNumberId}]},'ambiguous_phone'],
    [{data:[]},'invalid_response'],
    [{data:[{id:'not-number'}]},'invalid_response'],
    [{data:[{id:phoneNumberId}],paging:{next:'https://graph.facebook.com/next'}},'invalid_response'],
    [{data:'wrong-shape'},'invalid_response'],
  ])('fails closed on ambiguous, paged or malformed WABA listing (%s)',async (listing,reason)=>{
    request.mockReset().mockResolvedValueOnce(json(listing));
    await expect(verifier.verify(input)).resolves.toEqual({verified:false,reason});
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{id:'111111111111111',is_on_biz_app:true,platform_type:'CLOUD_API'},'phone_mismatch'],
    [{id:phoneNumberId,is_on_biz_app:false,platform_type:'CLOUD_API'},'not_coexistence'],
    [{id:phoneNumberId,is_on_biz_app:'true',platform_type:'CLOUD_API'},'not_coexistence'],
    [{id:phoneNumberId,is_on_biz_app:true,platform_type:'ON_PREMISE'},'not_coexistence'],
  ])('rejects unverified Meta phone state (%s)',async (details,reason)=>{
    request.mockReset().mockResolvedValueOnce(json({data:[{id:phoneNumberId}]}))
      .mockResolvedValueOnce(json(details));
    await expect(verifier.verify(input)).resolves.toEqual({verified:false,reason});
  });

  it('fails closed on denied API calls, network failures and malformed responses', async () => {
    request.mockReset().mockResolvedValueOnce(json({error:{message:'PRIVATE_RESPONSE'}},403));
    await expect(verifier.verify(input)).resolves.toEqual({
      verified:false,reason:'meta_unavailable',
    });
    request.mockReset().mockRejectedValueOnce(Error('SYNTHETIC_SECRET_IN_ERROR'));
    const second = await verifier.verify(input);
    expect(second).toEqual({verified:false,reason:'meta_unavailable'});
    expect(JSON.stringify(second)).not.toMatch(/PRIVATE_RESPONSE|SYNTHETIC_SECRET/);
    request.mockReset().mockResolvedValueOnce(new Response('broken json'));
    await expect(verifier.verify(input)).resolves.toEqual({
      verified:false,reason:'meta_unavailable',
    });
  });
});
