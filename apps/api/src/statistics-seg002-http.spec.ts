import { createHmac } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { StatisticsController } from './statistics.controller';
import { SupabaseService } from './supabase.service';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OWNER_A = '11111111-1111-4111-8111-111111111111';
const OWNER_B = '22222222-2222-4222-8222-222222222222';
const ADVISOR_ALLOWED = '33333333-3333-4333-8333-333333333333';
const ADVISOR_DENIED = '44444444-4444-4444-8444-444444444444';
const MEMBER_INACTIVE = '55555555-5555-4555-8555-555555555555';
const OWNER_DOWNGRADED = '66666666-6666-4666-8666-666666666666';
const PROFILE_INACTIVE = '77777777-7777-4777-8777-777777777777';
const ROLE_WRONG_COMPANY = '88888888-8888-4888-8888-888888888888';
const OWNER_ROLE = '99999999-9999-4999-8999-999999999991';
const ADVISOR_YES_ROLE = '99999999-9999-4999-8999-999999999992';
const ADVISOR_NO_ROLE = '99999999-9999-4999-8999-999999999993';
const ROLE_FROM_B = '99999999-9999-4999-8999-999999999994';

const SHARED_KEY = 'SEG002_HTTP_TEST_INTERNAL_KEY_NO_LIVE_SECRETS';
const SIGNING_KEY = 'SEG002_HTTP_TEST_SIGNING_KEY_ISOLATED_FROM_RAILWAY_2026';
const FROM = '2026-11-11T00:00:00.000Z';
const TO = '2026-11-12T00:00:00.000Z';
const TZ = 'America/Bogota';
const BUCKET = 'hour';

type Row = Record<string, unknown>;

function createSyntheticDatabase() {
  const tables: Record<string, Row[]> = {
    companies: [
      { id: A, status: 'active' },
      { id: B, status: 'active' },
    ],
    company_memberships: [
      {company_id:A,user_id:OWNER_A,role_id:OWNER_ROLE,active:true},
      {company_id:B,user_id:OWNER_B,role_id:OWNER_ROLE,active:true},
      {company_id:A,user_id:ADVISOR_ALLOWED,role_id:ADVISOR_YES_ROLE,active:true},
      {company_id:A,user_id:ADVISOR_DENIED,role_id:ADVISOR_NO_ROLE,active:true},
      {company_id:A,user_id:MEMBER_INACTIVE,role_id:OWNER_ROLE,active:false},
      {company_id:A,user_id:OWNER_DOWNGRADED,role_id:ADVISOR_NO_ROLE,active:true},
      {company_id:A,user_id:PROFILE_INACTIVE,role_id:OWNER_ROLE,active:true},
      {company_id:A,user_id:ROLE_WRONG_COMPANY,role_id:ROLE_FROM_B,active:true},
    ],
    app_profiles: [
      ...[OWNER_A,OWNER_B,ADVISOR_ALLOWED,ADVISOR_DENIED,MEMBER_INACTIVE,
        OWNER_DOWNGRADED,ROLE_WRONG_COMPANY].map(user_id=>({user_id,active:true})),
      {user_id:PROFILE_INACTIVE,active:false},
    ],
    app_roles: [
      {id:OWNER_ROLE,key:'owner',company_id:null},
      {id:ADVISOR_YES_ROLE,key:'advisor',company_id:A},
      {id:ADVISOR_NO_ROLE,key:'advisor',company_id:A},
      {id:ROLE_FROM_B,key:'owner',company_id:B},
    ],
    app_role_permissions: [
      {role_id:ADVISOR_YES_ROLE,permission_id:'permission-statistics'},
      {role_id:ADVISOR_NO_ROLE,permission_id:'permission-inbox'},
    ],
    app_permissions: [
      {id:'permission-statistics',key:'statistics.view'},
      {id:'permission-inbox',key:'inbox.view'},
    ],
  };
  const rpc = jest.fn(async (_name: string, params: Record<string, unknown>) =>
    ({ data: { summary: {customerMessages: params.p_company_id === A ? 3 : 1} }, error: null }));
  const from = jest.fn((table: string) => {
    const eqs: Record<string, unknown> = {};
    const ins: Record<string, unknown[]> = {};
    const rows = () => (tables[table] || []).filter(item =>
      Object.entries(eqs).every(([key,val])=>item[key] === val) &&
      Object.entries(ins).every(([key,vals])=>vals.includes(item[key])));
    const query: any = {
      select: () => query,
      eq: (key: string,val: unknown) => {eqs[key]=val;return query;},
      in: (key: string,vals: unknown[]) => {ins[key]=vals;return query;},
      maybeSingle: async () => ({data: rows()[0] || null,error:null}),
      then: (resolve: (result: unknown)=>unknown,reject: (error: unknown)=>unknown) =>
        Promise.resolve({data:rows(),error:null}).then(resolve,reject),
    };
    return query;
  });
  return {tables,from,rpc};
}

function signed(userId: string,companyId: string,options?: {
  issuedAt?: number;
  to?: string;
  timezone?: string;
}) {
  const encoded = Buffer.from(JSON.stringify({
    v: 1, companyId, userId, from:FROM,
    to:options?.to || TO,
    timezone:options?.timezone || TZ,
    bucket:BUCKET,
    issuedAt:options?.issuedAt ?? Date.now(),
  })).toString('base64url');
  const signature = createHmac('sha256',SIGNING_KEY).update(encoded).digest('base64url');
  return encoded+'.'+signature;
}

describe('SEG-002 HTTP authorization through real Nest route (synthetic tenants)', () => {
  let app: INestApplication;
  let db: ReturnType<typeof createSyntheticDatabase>;
  let oldInbox: string | undefined;
  let oldSign: string | undefined;

  beforeEach(async () => {
    oldInbox=process.env.CHATPRO_INBOX_KEY;
    oldSign=process.env.MW1_STATS_CONTEXT_SECRET;
    process.env.CHATPRO_INBOX_KEY=SHARED_KEY;
    process.env.MW1_STATS_CONTEXT_SECRET=SIGNING_KEY;
    db=createSyntheticDatabase();
    const module = await Test.createTestingModule({
      controllers:[StatisticsController],
      providers:[{provide:SupabaseService,useValue:{getClient:()=>db}}],
    }).compile();
    app=module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    if(oldInbox===undefined)delete process.env.CHATPRO_INBOX_KEY;
    else process.env.CHATPRO_INBOX_KEY=oldInbox;
    if(oldSign===undefined)delete process.env.MW1_STATS_CONTEXT_SECRET;
    else process.env.MW1_STATS_CONTEXT_SECRET=oldSign;
  });

  function get(userId:string,companyId:string,options?:{
    signature?:string;
    headerCompany?:string;
    serviceKey?:string;
    to?:string;
    timezone?:string;
  }) {
    return request(app.getHttpServer()).get('/statistics')
      .query({from:FROM,to:options?.to||TO,timezone:options?.timezone||TZ,bucket:BUCKET})
      .set('x-chatpro-inbox-key', options?.serviceKey??SHARED_KEY)
      .set('x-chatpro-company-id',options?.headerCompany??companyId)
      .set('x-mw1-stats-context',options?.signature??signed(userId,companyId));
  }

  it('returns 200 for owner Alfa and only aggregates Alfa', async () => {
    const r=await get(OWNER_A,A).expect(200);
    expect(r.body).toMatchObject({ok:true,statistics:{summary:{customerMessages:3}}});
    expect(db.rpc).toHaveBeenCalledWith('chatpro_statistics_summary',expect.objectContaining({p_company_id:A}));
  });

  it('returns 200 for owner Beta and only aggregates Beta', async () => {
    const r=await get(OWNER_B,B).expect(200);
    expect(r.body).toMatchObject({ok:true,statistics:{summary:{customerMessages:1}}});
    expect(db.rpc).toHaveBeenCalledWith('chatpro_statistics_summary',expect.objectContaining({p_company_id:B}));
  });

  it('returns 200 for Alfa advisor with statistics.view', async () => {
    await get(ADVISOR_ALLOWED,A).expect(200);
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });

  it('returns 403 for advisor without statistics permissions, before RPC', async () => {
    await get(ADVISOR_DENIED,A).expect(403);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('returns 403 for Alfa owner trying to query Beta with a valid Beta signature', async () => {
    await get(OWNER_A,B).expect(403);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('returns 403 for Alfa permitted advisor trying to query Beta', async () => {
    await get(ADVISOR_ALLOWED,B).expect(403);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('returns 401 if company header changed from signed Alfa to Beta', async () => {
    await get(OWNER_A,A,{headerCompany:B}).expect(401);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('returns 401 for forged HMAC even when service key is valid', async () => {
    const valid=signed(OWNER_A,A);
    await get(OWNER_A,A,{signature:valid.slice(0,-3)+'bad'}).expect(401);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('returns 401 for an expired HMAC', async () => {
    await get(OWNER_A,A,{signature:signed(OWNER_A,A,{issuedAt:Date.now()-31000})}).expect(401);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('returns 401 if the internal service key is invalid', async () => {
    await get(OWNER_A,A,{serviceKey:'wrong-service-key'}).expect(401);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('returns 403 after membership is disabled with otherwise valid signature', async () => {
    await get(MEMBER_INACTIVE,A).expect(403);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('returns 403 after role is downgraded, despite owner-like prior session', async () => {
    await get(OWNER_DOWNGRADED,A).expect(403);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('returns 403 when the user profile itself is inactive', async () => {
    await get(PROFILE_INACTIVE,A).expect(403);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('returns 403 when membership references a role scoped to another tenant', async () => {
    await get(ROLE_WRONG_COMPANY,A).expect(403);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('returns 401 if date query changed after signing', async () => {
    await get(OWNER_A,A,{to:'2026-11-13T00:00:00.000Z'}).expect(401);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('returns 401 if timezone changed after signing', async () => {
    await get(OWNER_A,A,{timezone:'UTC'}).expect(401);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('returns 403 for a deactivated company', async () => {
    db.tables.companies[0].status='inactive';
    await get(OWNER_A,A).expect(403);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('rechecks permissions on a subsequent request instead of caching the role', async () => {
    await get(ADVISOR_ALLOWED,A).expect(200);
    db.tables.company_memberships.find(x=>x.user_id===ADVISOR_ALLOWED)!.role_id=ADVISOR_NO_ROLE;
    await get(ADVISOR_ALLOWED,A).expect(403);
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
});
