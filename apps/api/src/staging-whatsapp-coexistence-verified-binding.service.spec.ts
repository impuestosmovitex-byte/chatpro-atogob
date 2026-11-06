import { StagingWhatsappCoexistenceVerifiedBindingService } from
  './staging-whatsapp-coexistence-verified-binding.service';
import type { SupabaseService } from './supabase.service';
import type { StagingWhatsappCoexistenceMetaTokenReviewService } from
  './staging-whatsapp-coexistence-meta-token-review.service';
import type { StagingWhatsappCoexistenceMetaGraphService } from
  './staging-whatsapp-coexistence-meta-graph.service';

describe('staging Meta coexistence verified binding',()=>{
  const original={
    mode:process.env.MW1_STAGING_MODE,
    db:process.env.SUPABASE_URL,
    launch:process.env.MW1_STAGING_WHATSAPP_COEXISTENCE_META_LAUNCH_ENABLED,
    review:process.env.MW1_STAGING_WHATSAPP_COEXISTENCE_META_REVIEW_ENABLED,
  };
  const getClient=jest.fn();
  const review=jest.fn();
  const verify=jest.fn();
  const binder=new StagingWhatsappCoexistenceVerifiedBindingService(
    {getClient} as unknown as SupabaseService,
    {review} as unknown as StagingWhatsappCoexistenceMetaTokenReviewService,
    {verify} as unknown as StagingWhatsappCoexistenceMetaGraphService,
  );
  const actor={
    internalKey:'UNIT_TEST_ONLY',companySlug:'piloto-mw1-prueba',
    companyId:'11111111-1111-4111-8111-111111111111',
    userId:'22222222-2222-4222-8222-222222222222',
  };
  const valid={
    actor,onboardingId:'33333333-3333-4333-8333-333333333333',
    wabaId:'123456789012',phoneNumberId:'987654321098',
    accessToken:'TEST_ONLY_NOT_REAL_TOKEN_123456789',
    metaBusinessIdHint:null,
  };
  beforeEach(()=>{
    jest.clearAllMocks();
    process.env.MW1_STAGING_MODE='true';
    process.env.SUPABASE_URL='https://zqfbxqszfnrbwpfukwak.supabase.co';
    process.env.MW1_STAGING_WHATSAPP_COEXISTENCE_META_LAUNCH_ENABLED='false';
    process.env.MW1_STAGING_WHATSAPP_COEXISTENCE_META_REVIEW_ENABLED='false';
  });
  afterAll(()=>{
    const mapping={
      MW1_STAGING_MODE:original.mode,
      SUPABASE_URL:original.db,
      MW1_STAGING_WHATSAPP_COEXISTENCE_META_LAUNCH_ENABLED:original.launch,
      MW1_STAGING_WHATSAPP_COEXISTENCE_META_REVIEW_ENABLED:original.review,
    };
    for(const [k,v] of Object.entries(mapping)){
      if(v===undefined)delete process.env[k];else process.env[k]=v;
    }
  });
  it('never verifies or stores anything while launch/review flags are off',async()=>{
    expect(await binder.bind(valid)).toBe(false);
    expect(getClient).not.toHaveBeenCalled();
    expect(review).not.toHaveBeenCalled();
  });
  it('rejects production and any other Supabase project',async()=>{
    process.env.MW1_STAGING_WHATSAPP_COEXISTENCE_META_LAUNCH_ENABLED='true';
    process.env.MW1_STAGING_WHATSAPP_COEXISTENCE_META_REVIEW_ENABLED='true';
    process.env.MW1_STAGING_MODE='false';
    expect(await binder.bind(valid)).toBe(false);
    process.env.MW1_STAGING_MODE='true';
    process.env.SUPABASE_URL='https://example.supabase.co';
    expect(await binder.bind(valid)).toBe(false);
    expect(getClient).not.toHaveBeenCalled();
  });
  it('rejects operational tenants before issuing Graph or DB requests',async()=>{
    process.env.MW1_STAGING_WHATSAPP_COEXISTENCE_META_LAUNCH_ENABLED='true';
    process.env.MW1_STAGING_WHATSAPP_COEXISTENCE_META_REVIEW_ENABLED='true';
    for(const slug of ['atogob','maogo']){
      expect(await binder.bind({...valid,actor:{...actor,companySlug:slug}})).toBe(false);
    }
    expect(getClient).not.toHaveBeenCalled();
    expect(review).not.toHaveBeenCalled();
  });
  it('rejects invalid Meta business hints and credentials',async()=>{
    process.env.MW1_STAGING_WHATSAPP_COEXISTENCE_META_LAUNCH_ENABLED='true';
    process.env.MW1_STAGING_WHATSAPP_COEXISTENCE_META_REVIEW_ENABLED='true';
    expect(await binder.bind({...valid,metaBusinessIdHint:'not-a-meta-id'})).toBe(false);
    expect(await binder.bind({...valid,accessToken:'tiny'})).toBe(false);
    expect(getClient).not.toHaveBeenCalled();
  });
});
