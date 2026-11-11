import { createHmac } from 'node:crypto';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { StatisticsController } from './statistics.controller';
import { verifyStatisticsContext } from './statistics-context';

const COMPANY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COMPANY_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OWNER_A = '11111111-1111-4111-8111-111111111111';
const OWNER_B = '22222222-2222-4222-8222-222222222222';
const ADVISOR_ALLOWED = '33333333-3333-4333-8333-333333333333';
const ADVISOR_DENIED = '44444444-4444-4444-8444-444444444444';
const INACTIVE = '55555555-5555-4555-8555-555555555555';
const DOWNGRADED = '66666666-6666-4666-8666-666666666666';
const PROFILE_DISABLED = '77777777-7777-4777-8777-777777777777';
const OTHER_TENANT_ROLE = '88888888-8888-4888-8888-888888888888';
const OWNER_ROLE = '99999999-9999-4999-8999-999999999991';
const ADVISOR_ALLOWED_ROLE = '99999999-9999-4999-8999-999999999992';
const ADVISOR_DENIED_ROLE = '99999999-9999-4999-8999-999999999993';
const OTHER_ROLE = '99999999-9999-4999-8999-999999999994';
const KEY = 'mw1-seg002-dedicated-secret-with-more-than-32-characters';
const INTERNAL_KEY = 'mw1-seg002-internal-test-service-secret';
const FROM = '2026-11-01T00:00:00.000Z';
const TO = '2026-11-11T00:00:00.000Z';

function createAssertion(userId: string, companyId: string, time = Date.now()) {
  const encoded = Buffer.from(JSON.stringify({
    v: 1, companyId, userId, from: FROM, to: TO,
    timezone: 'America/Bogota', bucket: 'hour', issuedAt: time,
  }), 'utf8').toString('base64url');
  return encoded + '.' + createHmac('sha256', KEY).update(encoded).digest('base64url');
}

function fakeSupabase() {
  const tables: Record<string, Array<Record<string, any>>> = {
    companies: [
      { id: COMPANY_A, status: 'active' },
      { id: COMPANY_B, status: 'active' },
    ],
    company_memberships: [
      { company_id: COMPANY_A, user_id: OWNER_A, role_id: OWNER_ROLE, active: true },
      { company_id: COMPANY_B, user_id: OWNER_B, role_id: OWNER_ROLE, active: true },
      { company_id: COMPANY_A, user_id: ADVISOR_ALLOWED, role_id: ADVISOR_ALLOWED_ROLE, active: true },
      { company_id: COMPANY_A, user_id: ADVISOR_DENIED, role_id: ADVISOR_DENIED_ROLE, active: true },
      { company_id: COMPANY_A, user_id: INACTIVE, role_id: OWNER_ROLE, active: false },
      { company_id: COMPANY_A, user_id: DOWNGRADED, role_id: ADVISOR_DENIED_ROLE, active: true },
      { company_id: COMPANY_A, user_id: PROFILE_DISABLED, role_id: OWNER_ROLE, active: true },
      { company_id: COMPANY_A, user_id: OTHER_TENANT_ROLE, role_id: OTHER_ROLE, active: true },
    ],
    app_profiles: [
      ...[OWNER_A,OWNER_B,ADVISOR_ALLOWED,ADVISOR_DENIED,INACTIVE,DOWNGRADED,OTHER_TENANT_ROLE]
        .map(user_id => ({user_id,active:true})),
      {user_id:PROFILE_DISABLED,active:false},
    ],
    app_roles: [
      {id:OWNER_ROLE,key:'owner',company_id:null},
      {id:ADVISOR_ALLOWED_ROLE,key:'advisor',company_id:COMPANY_A},
      {id:ADVISOR_DENIED_ROLE,key:'advisor',company_id:COMPANY_A},
      {id:OTHER_ROLE,key:'owner',company_id:COMPANY_B},
    ],
    app_role_permissions: [
      {role_id:ADVISOR_ALLOWED_ROLE,permission_id:'permission-statistics'},
      {role_id:ADVISOR_DENIED_ROLE,permission_id:'permission-inbox'},
    ],
    app_permissions: [
      {id:'permission-statistics',key:'statistics.view'},
      {id:'permission-inbox',key:'inbox.view'},
    ],
  };
  const rpc = jest.fn().mockResolvedValue({data:{summary:{customerMessages:5}},error:null});
  const from = jest.fn((table: string) => {
    const equals: Record<string,unknown> = {};
    const includes: Record<string,unknown[]> = {};
    const rows = () => (tables[table] || []).filter(item =>
      Object.entries(equals).every(([key,val]) => item[key] === val) &&
      Object.entries(includes).every(([key,vals]) => vals.includes(item[key])));
    const q: any = {
      select: (_fields: string) => q,
      eq: (field:string,value:unknown) => {equals[field]=value; return q;},
      in: (field:string,values:unknown[]) => {includes[field]=values; return q;},
      maybeSingle: async () => ({data:rows()[0] || null,error:null}),
      then: (resolve:any,reject:any) =>
        Promise.resolve({data:rows(),error:null}).then(resolve,reject),
    };
    return q;
  });
  return {from, rpc};
}

describe('SEG-002 statistics tenant authorization', () => {
  let db: ReturnType<typeof fakeSupabase>;
  let controller: StatisticsController;
  let oldInbox: string | undefined;
  let oldSecret: string | undefined;
  beforeEach(() => {
    oldInbox = process.env.CHATPRO_INBOX_KEY;
    oldSecret = process.env.MW1_STATS_CONTEXT_SECRET;
    process.env.CHATPRO_INBOX_KEY = INTERNAL_KEY;
    process.env.MW1_STATS_CONTEXT_SECRET = KEY;
    db = fakeSupabase();
    controller = new StatisticsController({ getClient: () => db } as any);
  });
  afterEach(() => {
    if (oldInbox === undefined) delete process.env.CHATPRO_INBOX_KEY;
    else process.env.CHATPRO_INBOX_KEY = oldInbox;
    if (oldSecret === undefined) delete process.env.MW1_STATS_CONTEXT_SECRET;
    else process.env.MW1_STATS_CONTEXT_SECRET = oldSecret;
  });

  const request = (ctrl:StatisticsController,user:string,tenant:string,token = createAssertion(user,tenant)) =>
    ctrl.getStatistics(INTERNAL_KEY,tenant,token,FROM,TO,'America/Bogota','hour');

  it('accepts owner A for A; scoped RPC receives exactly A', async () => {
    await expect(request(controller, OWNER_A,COMPANY_A)).resolves.toMatchObject({ok:true});
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.rpc).toHaveBeenCalledWith('chatpro_statistics_summary',expect.objectContaining({p_company_id:COMPANY_A}));
  });
  it('accepts owner B for B',async () => {
    await expect(request(controller,OWNER_B,COMPANY_B)).resolves.toMatchObject({ok:true});
  });
  it('accepts only a specifically permitted advisor of A',async () => {
    await expect(request(controller,ADVISOR_ALLOWED,COMPANY_A)).resolves.toMatchObject({ok:true});
  });
  it('rejects advisor without statistics permission',async () => {
    await expect(request(controller,ADVISOR_DENIED,COMPANY_A)).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it('rejects owner A attempting B even with a correctly signed B request',async () => {
    await expect(request(controller,OWNER_A,COMPANY_B)).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it('rejects permitted advisor A attempting B',async () => {
    await expect(request(controller,ADVISOR_ALLOWED,COMPANY_B)).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it('rejects signed tenant A if caller changes company header to B',async () => {
    await expect(request(controller,OWNER_A,COMPANY_B,createAssertion(OWNER_A,COMPANY_A)))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it('rejects disabled memberships and globally inactive profiles',async () => {
    await expect(request(controller,INACTIVE,COMPANY_A)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(request(controller,PROFILE_DISABLED,COMPANY_A)).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it('rejects old owner session when live role has been downgraded',async () => {
    await expect(request(controller,DOWNGRADED,COMPANY_A)).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it('rejects role identifiers belonging to another tenant',async () => {
    await expect(request(controller,OTHER_TENANT_ROLE,COMPANY_A)).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it('rejects forged, expired and missing assertions before RPC',async () => {
    const ok = createAssertion(OWNER_A,COMPANY_A);
    expect(verifyStatisticsContext(ok,KEY)).not.toBeNull();
    expect(verifyStatisticsContext(ok.slice(0,-3)+'bad',KEY)).toBeNull();
    await expect(request(controller,OWNER_A,COMPANY_A,ok.slice(0,-3)+'bad'))
      .rejects.toBeInstanceOf(UnauthorizedException);
    await expect(request(controller,OWNER_A,COMPANY_A,createAssertion(OWNER_A,COMPANY_A,Date.now()-31_000)))
      .rejects.toBeInstanceOf(UnauthorizedException);
    await expect(request(controller,OWNER_A,COMPANY_A,'')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it('rejects missing dedicated signing secret, not falling back to shared inbox key',async () => {
    delete process.env.MW1_STATS_CONTEXT_SECRET;
    await expect(request(controller,OWNER_A,COMPANY_A)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it('rejects changed query parameters even if tenant and identity are valid',async () => {
    await expect(controller.getStatistics(INTERNAL_KEY,COMPANY_A,createAssertion(OWNER_A,COMPANY_A),
      FROM,'2026-11-12T00:00:00.000Z','America/Bogota','hour'))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it('rejects requests without internal service key',async () => {
    await expect(controller.getStatistics('',COMPANY_A,createAssertion(OWNER_A,COMPANY_A),
      FROM,TO,'America/Bogota','hour')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
