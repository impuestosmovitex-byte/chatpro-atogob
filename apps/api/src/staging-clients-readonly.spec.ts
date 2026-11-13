import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { StagingClientsReadonlyController } from './staging-clients-readonly.controller';

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
    'alpha', '', '100');
  return { controller, queries, list };
}
describe('SEG-003 staging clients read-only and tenant authorization', () => {
  beforeEach(() => {
    process.env.MW1_STAGING_MODE = 'true';
    process.env.CHATPRO_INBOX_KEY = 'test-secret';
  });
  afterEach(() => {
    delete process.env.MW1_STAGING_MODE;
    delete process.env.CHATPRO_INBOX_KEY;
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
    await expect(controller.list('test-secret','user','user-alpha','beta','beta'))
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
      'alpha','alpha')).rejects.toBeInstanceOf(UnauthorizedException);
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
      'alpha','alpha','3002222222')).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('does not register create or update methods', () => {
    const { controller } = mockDb();
    expect((controller as any).create).toBeUndefined();
    expect((controller as any).saveContact).toBeUndefined();
  });
});
