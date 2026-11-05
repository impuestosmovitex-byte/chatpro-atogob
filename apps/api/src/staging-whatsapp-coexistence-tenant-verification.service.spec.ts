import { SupabaseService } from './supabase.service';
import { StagingWhatsappCoexistenceMetaGraphService } from
  './staging-whatsapp-coexistence-meta-graph.service';
import { StagingWhatsappCoexistenceMetaTokenReviewService } from
  './staging-whatsapp-coexistence-meta-token-review.service';
import {
  StagingWhatsappCoexistenceTenantVerificationService,
  type PilotCoexistenceVerificationInput,
} from './staging-whatsapp-coexistence-tenant-verification.service';

describe('MW1 pilot tenant authorization before Meta coexistence verification (offline)', () => {
  const companyId = '11111111-1111-4111-8111-111111111111';
  const userId = '22222222-2222-4222-8222-222222222222';
  const roleId = '33333333-3333-4333-8333-333333333333';
  const input: PilotCoexistenceVerificationInput = {
    internalKey: 'SYNTHETIC-INTERNAL-KEY-ONLY',
    companySlug: 'piloto-mw1-prueba',
    companyId, userId,
    wabaId: '123456789012345',
    phoneNumberId: '987654321098765',
    accessToken: 'SYNTHETIC_META_TOKEN_NOT_REAL_1234567890',
  };
  type QueryResult = {data: unknown;error: unknown};
  const fixtures: Record<string, QueryResult> = {};
  const from = jest.fn();
  const getClient = jest.fn();
  const metaVerify = jest.fn();
  const tokenReview = jest.fn();
  let service: StagingWhatsappCoexistenceTenantVerificationService;
  const env = ['MW1_STAGING_MODE','SUPABASE_URL','CHATPRO_INBOX_KEY'] as const;
  const original = new Map<string,string | undefined>();

  function setupDb() {
    from.mockImplementation((table: string) => {
      const query: Record<string,jest.Mock> = {};
      query.select = jest.fn().mockReturnValue(query);
      query.eq = jest.fn().mockReturnValue(query);
      query.maybeSingle = jest.fn(async () => fixtures[table]);
      query.limit = jest.fn(async () => fixtures[table]);
      return query;
    });
  }
  beforeAll(() => env.forEach(k => original.set(k,process.env[k])));
  afterAll(() => {
    for (const [key,value] of original) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  beforeEach(() => {
    process.env.MW1_STAGING_MODE = 'true';
    process.env.SUPABASE_URL = 'https://zqfbxqszfnrbwpfukwak.supabase.co';
    process.env.CHATPRO_INBOX_KEY = input.internalKey;
    Object.assign(fixtures,{
      companies:{data:{id:companyId,slug:'piloto-mw1-prueba',status:'active'},error:null},
      company_memberships:{data:{role_id:roleId,active:true},error:null},
      app_roles:{data:{key:'owner',company_id:companyId},error:null},
      company_integrations:{data:[],error:null},
    });
    from.mockReset();
    getClient.mockReset().mockReturnValue({from});
    metaVerify.mockReset().mockResolvedValue({
      verified:true,wabaId:input.wabaId,phoneNumberId:input.phoneNumberId,
    });
    tokenReview.mockReset().mockResolvedValue({
      reviewed:true,wabaId:input.wabaId,appId:'123456789012345',
    });
    setupDb();
    service = new StagingWhatsappCoexistenceTenantVerificationService(
      {getClient} as unknown as SupabaseService,
      {verify:metaVerify} as unknown as StagingWhatsappCoexistenceMetaGraphService,
      {review:tokenReview} as unknown as StagingWhatsappCoexistenceMetaTokenReviewService,
    );
  });

  const blocked = (reason:string) => ({readyForLaterProvisioningReview:false,reason});

  it('allows a valid pilot owner to reach the read-only Meta verifier', async () => {
    await expect(service.verify(input)).resolves.toEqual({
      readyForLaterProvisioningReview:true,
      wabaId:input.wabaId,phoneNumberId:input.phoneNumberId,
    });
    expect(from.mock.calls.map(call=>call[0])).toEqual([
      'companies','company_memberships','app_roles','company_integrations',
    ]);
    expect(tokenReview).toHaveBeenCalledTimes(1);
    expect(tokenReview).toHaveBeenCalledWith(input.accessToken,input.wabaId);
    expect(metaVerify).toHaveBeenCalledTimes(1);
    expect(metaVerify).toHaveBeenCalledWith({
      wabaId:input.wabaId,phoneNumberId:input.phoneNumberId,
      accessToken:input.accessToken,
    });
  });

  it('blocks wrong environment and other Supabase projects before DB and Meta',async()=>{
    process.env.MW1_STAGING_MODE = 'false';
    await expect(service.verify(input)).resolves.toEqual(blocked('staging_only'));
    process.env.MW1_STAGING_MODE = 'true';
    process.env.SUPABASE_URL = 'https://not-the-pilot.supabase.co';
    await expect(service.verify(input)).resolves.toEqual(blocked('staging_only'));
    expect(getClient).not.toHaveBeenCalled();
    expect(metaVerify).not.toHaveBeenCalled();
  });

  it.each([
    [{internalKey:'bad'},'unauthorized'],
    [{companySlug:'atogob'},'invalid_input'],
    [{companyId:'bad'},'invalid_input'],
    [{userId:'not-a-uuid'},'invalid_input'],
    [{wabaId:'not-numeric'},'invalid_input'],
    [{phoneNumberId:'invalid'},'invalid_input'],
    [{accessToken:'too-short'},'invalid_input'],
    [{accessToken:'SYNTHETIC_META_TOKEN_NEWLINE_123\n'},'invalid_input'],
  ])('rejects malformed or unauthorized input without DB or Meta (%s)',async (patch,reason)=>{
    await expect(service.verify({...input,...patch})).resolves.toEqual(blocked(reason));
    expect(getClient).not.toHaveBeenCalled();
    expect(metaVerify).not.toHaveBeenCalled();
  });

  it.each([
    ['companies',{data:{id:companyId,slug:'piloto-mw1-prueba',status:'disabled'},error:null}],
    ['companies',{data:null,error:null}],
    ['company_memberships',{data:null,error:null}],
    ['company_memberships',{data:{role_id:roleId,active:false},error:null}],
    ['app_roles',{data:{key:'agent',company_id:companyId},error:null}],
    ['app_roles',{data:{key:'admin',company_id:'99999999-9999-4999-8999-999999999999'},error:null}],
  ])('rejects invalid pilot company, membership and roles (%s)',async(table,wrong)=>{
    fixtures[table] = wrong;
    await expect(service.verify(input)).resolves.toEqual(blocked('tenant_not_authorized'));
    expect(metaVerify).not.toHaveBeenCalled();
  });

  it('accepts an active pilot admin with global company role',async()=>{
    fixtures.app_roles = {data:{key:'admin',company_id:null},error:null};
    await expect(service.verify(input)).resolves.toMatchObject({
      readyForLaterProvisioningReview:true,
    });
    expect(metaVerify).toHaveBeenCalledTimes(1);
  });

  it('rejects an already connected number in ANY company before querying Meta',async()=>{
    fixtures.company_integrations = {data:[{company_id:'44444444-4444-4444-8444-444444444444'}],error:null};
    await expect(service.verify(input)).resolves.toEqual(blocked('phone_already_registered'));
    expect(metaVerify).not.toHaveBeenCalled();
    fixtures.company_integrations = {data:[{company_id:companyId}],error:null};
    await expect(service.verify(input)).resolves.toEqual(blocked('phone_already_registered'));
    expect(metaVerify).not.toHaveBeenCalled();
  });

  it('rejects database failures and never touches Meta',async()=>{
    fixtures.company_integrations = {data:null,error:{message:'SECRET_DB_ERROR'}};
    await expect(service.verify(input)).resolves.toEqual(blocked('database_unavailable'));
    expect(metaVerify).not.toHaveBeenCalled();
    getClient.mockImplementationOnce(()=>{throw Error('PRIVATE_DATABASE_ERROR');});
    const result = await service.verify(input);
    expect(result).toEqual(blocked('database_unavailable'));
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_/);
    expect(metaVerify).not.toHaveBeenCalled();
  });

  it('does not mark a number ready if Meta rejects its WABA or coexistence status',async()=>{
    metaVerify.mockResolvedValue({verified:false,reason:'not_coexistence'});
    await expect(service.verify(input)).resolves.toEqual(blocked('meta_verification_failed'));
    metaVerify.mockRejectedValue(Error('PRIVATE_META_TOKEN'));
    const result = await service.verify(input);
    expect(result).toEqual(blocked('meta_verification_failed'));
    expect(JSON.stringify(result)).not.toContain('PRIVATE_META_TOKEN');
  });

  it('does not query the Meta phone without a valid app/WABA token grant',async()=>{
    tokenReview.mockResolvedValue({reviewed:false,reason:'waba_grant_unconfirmed'});
    await expect(service.verify(input)).resolves.toEqual(
      blocked('meta_token_unconfirmed'));
    expect(tokenReview).toHaveBeenCalledTimes(1);
    expect(metaVerify).not.toHaveBeenCalled();
  });

  it('never accepts another WABA in token evidence, even when the token reviewer returns success',async()=>{
    tokenReview.mockResolvedValue({
      reviewed:true,appId:'123456789012345',wabaId:'111111111111111',
    });
    await expect(service.verify(input)).resolves.toEqual(
      blocked('meta_token_unconfirmed'));
    expect(metaVerify).not.toHaveBeenCalled();
  });

  it('fails closed if the token review raises an exception',async()=>{
    tokenReview.mockRejectedValue(Error('PRIVATE_ACCESS_TOKEN'));
    const result=await service.verify(input);
    expect(result).toEqual(blocked('meta_token_unconfirmed'));
    expect(JSON.stringify(result)).not.toContain('PRIVATE_ACCESS_TOKEN');
    expect(metaVerify).not.toHaveBeenCalled();
  });

  it('has no method for registration, synchronization, message sending or webhook subscription',()=>{
    for (const method of ['activate','register','syncHistory','subscribeWebhook','sendMessage']){
      expect(service).not.toHaveProperty(method);
    }
  });
});
