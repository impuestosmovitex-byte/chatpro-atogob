import {createHash,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { StagingClientsReadonlyController } from './staging-clients-readonly.controller';

const keys=generateKeyPairSync('ed25519');
function canonical(value:unknown):string {
 if(value===undefined||value===null)return 'null';
 if(typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 const data=value as Record<string,unknown>;
 return '{'+Object.keys(data).filter(k=>data[k]!==undefined).sort()
  .map(k=>JSON.stringify(k)+':'+canonical(data[k])).join(',')+'}';
}
function assertion(path='/clients',body:unknown={search:'',limit:'100'},
 userId='user-alpha',companyId='alpha',companySlug='alpha') {
 const iat=Math.floor(Date.now()/1000);
 const payload={v:1,kind:'user',userId,companyId,companySlug,
  method:'GET',path,iat,exp:iat+20,nonce:randomBytes(16).toString('hex'),
  bodyHash:createHash('sha256').update(canonical(body)).digest('hex')};
 const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url');
 return encoded+'.'+sign(null,Buffer.from(encoded),keys.privateKey).toString('base64url');
}
type Row = Record<string, any>;
function mockDb(overrides: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {
    companies: [{ id: 'alpha', slug: 'alpha', name: 'Alfa Demo', status: 'active' },
      { id: 'beta', slug: 'beta', name: 'Beta Demo', status: 'active' }],
    app_profiles: [{ user_id: 'user-alpha', active: true }],
    company_memberships: [
      { user_id: 'user-alpha', company_id: 'alpha', active: true, role_id: 'owner-role' },
    ],
    app_roles: [{ id: 'owner-role', key: 'owner', company_id: 'alpha' }],
    app_role_permissions: [],
    app_permissions: [],
    conversation_sessions: [
      { id: 's-alpha', company_id: 'alpha', customer_phone: '3001111111',
        last_message_at: '2026-11-12T10:00:00Z', attention_status: 'ai' },
      { id: 's-beta', company_id: 'beta', customer_phone: '3002222222',
        last_message_at: '2026-11-12T10:00:00Z', attention_status: 'ai' },
    ],
    ...overrides,
  };
  const queries: Array<{table:string; filters:Array<[string,any]>}> = [];
  const db = {
    from(table: string) {
      const state = { table, filters: [] as Array<[string,any]> };
      queries.push(state);
      const result = () => tables[table]?.filter(row =>
        state.filters.every(([key, val]) => row[key] === val)) ?? [];
      const query: any = {
        select: () => query,
        eq: (key: string, value: any) => { state.filters.push([key,value]); return query; },
        order: () => query,
        limit: () => query,
        maybeSingle: async () => ({ data: result()[0] ?? null, error: null }),
        then: (yes: (v: any)=>any) =>
          Promise.resolve({ data: result(), error: null }).then(yes),
      };
      return query;
    },
  };
  const controller = new StagingClientsReadonlyController({
    getClient: () => db,
  } as any);
  const list = () => controller.list('test-secret', 'user', 'user-alpha', 'alpha',
    'alpha', '', '100',assertion());
  return { controller, queries, list };
}
describe('SEG-003 staging clients read-only and tenant authorization', () => {
  beforeEach(() => {
    process.env.MW1_STAGING_MODE = 'true';
    process.env.CHATPRO_INBOX_KEY = 'test-secret';
    process.env.MW1_INTERNAL_ATTESTATION_PUBLIC_KEY=keys.publicKey.export({format:'pem',type:'spki'}).toString();
    process.env.MW1_INTERNAL_SINGLE_REPLICA_ACK='true';
    process.env.MW1_INTERNAL_REPLICA_COUNT='1';
  });
  afterEach(() => {
    delete process.env.MW1_STAGING_MODE;
    delete process.env.CHATPRO_INBOX_KEY;
    delete process.env.MW1_INTERNAL_ATTESTATION_PUBLIC_KEY;
    delete process.env.MW1_INTERNAL_SINGLE_REPLICA_ACK;
    delete process.env.MW1_INTERNAL_REPLICA_COUNT;
  });
  it('returns only Alfa sessions and explicitly forbids editing', async () => {
    const { list, queries } = mockDb();
    const result = await list();
    expect(result.canEdit).toBe(false);
    expect(result.stagingReadOnly).toBe(true);
    expect(result.clients).toHaveLength(1);
    expect(result.clients[0].customerPhone).toBe('3001111111');
    expect(queries.find(q => q.table === 'conversation_sessions')?.filters)
      .toContainEqual(['company_id', 'alpha']);
  });
  it('rejects a user with no membership in requested company', async () => {
    const {controller} = mockDb();
    await expect(controller.list('test-secret','user','user-alpha','beta','beta','','100',assertion('/clients',{search:'',limit:'100'},'user-alpha','beta','beta')))
      .rejects.toBeInstanceOf(ForbiddenException);
  });
  it('rejects inactive accounts before reading client data', async () => {
    const { list, queries } = mockDb({
      app_profiles: [{ user_id: 'user-alpha', active: false }],
    });
    await expect(list()).rejects.toBeInstanceOf(ForbiddenException);
    expect(queries.some(q => q.table === 'conversation_sessions')).toBe(false);
  });
  it('rejects bootstrap and missing authentication', async () => {
    const { controller } = mockDb();
    await expect(controller.list('test-secret','bootstrap','user-alpha',
      'alpha','alpha','','100',assertion())).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('rejects role membership assigned to a different tenant', async () => {
    const { list } = mockDb({
      app_roles: [{ id:'owner-role', key:'owner',company_id:'beta' }],
    });
    await expect(list()).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('requires clients.view for a non-owner role', async () => {
    const { list } = mockDb({
      app_roles: [{id:'owner-role',key:'advisor',company_id:'alpha'}],
    });
    await expect(list()).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('does not expose an unrelated client profile via phone', async () => {
    const { controller } = mockDb();
    await expect(controller.profile('test-secret','user','user-alpha',
      'alpha','alpha','3002222222',assertion('/clients/profile',{phone:'3002222222'}))).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('rejects requests lacking a signature, and altered search or phone',async()=>{
    const {controller}=mockDb();
    await expect(controller.list('test-secret','user','user-alpha','alpha','alpha','','100',''))
      .rejects.toBeInstanceOf(UnauthorizedException);
    const signed=assertion();
    await expect(controller.list('test-secret','user','user-alpha','alpha','alpha','private','100',signed))
      .rejects.toBeInstanceOf(UnauthorizedException);
    const profileSignature=assertion('/clients/profile',{phone:'3001111111'});
    await expect(controller.profile('test-secret','user','user-alpha','alpha','alpha','3002222222',profileSignature))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('rejects modifying user, tenant or reusing one signed request',async()=>{
    const {controller}=mockDb();
    const signed=assertion();
    await expect(controller.list('test-secret','user','user-alpha','beta','beta','','100',signed))
      .rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.list('test-secret','user','user-beta','alpha','alpha','','100',signed))
      .rejects.toBeInstanceOf(UnauthorizedException);
    await controller.list('test-secret','user','user-alpha','alpha','alpha','','100',signed);
    await expect(controller.list('test-secret','user','user-alpha','alpha','alpha','','100',signed))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('keeps advisors limited to currently assigned human-attention clients',async()=>{
    const {list,controller}=mockDb({
      app_roles:[{id:'owner-role',key:'advisor',company_id:'alpha'}],
      app_role_permissions:[{role_id:'owner-role',permission_id:'permission-view'}],
      app_permissions:[{id:'permission-view',key:'clients.view'}],
      conversation_sessions:[
        {id:'assigned',company_id:'alpha',customer_phone:'3001111111',
         attention_status:'human',assigned_to_user_id:'user-alpha'},
        {id:'other',company_id:'alpha',customer_phone:'3003333333',
         attention_status:'human',assigned_to_user_id:'another-user'},
        {id:'unassigned',company_id:'alpha',customer_phone:'3004444444',
         attention_status:'ai',assigned_to_user_id:null},
      ],
    });
    const rows=await list();
    expect(rows.clients.map(x=>x.customerPhone)).toEqual(['3001111111']);
    await expect(controller.profile('test-secret','user','user-alpha','alpha',
     'alpha','3003333333',assertion('/clients/profile',{phone:'3003333333'})))
     .rejects.toBeInstanceOf(ForbiddenException);
  });
  it('revoked memberships block further reads before looking up conversations',async()=>{
    const {list,queries}=mockDb({company_memberships:[
      {user_id:'user-alpha',company_id:'alpha',active:false,role_id:'owner-role'},
    ]});
    await expect(list()).rejects.toBeInstanceOf(ForbiddenException);
    expect(queries.some(x=>x.table==='conversation_sessions')).toBe(false);
  });
  it('rejects cross-tenant signed profile lookups',async()=>{
    const {controller}=mockDb();
    await expect(controller.profile('test-secret','user','user-alpha','beta',
      'beta','3002222222',
      assertion('/clients/profile',{phone:'3002222222'},'user-alpha','beta','beta')))
      .rejects.toBeInstanceOf(ForbiddenException);
  });
  it('does not register create or update methods', () => {
    const { controller } = mockDb();
    expect((controller as any).create).toBeUndefined();
    expect((controller as any).saveContact).toBeUndefined();
  });
});
