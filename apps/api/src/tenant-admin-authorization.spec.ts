import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { TenantAdminAuthorization } from './tenant-admin-authorization';

type RecordRow = Record<string, unknown>;
type Database = Record<string, RecordRow[]>;
function harness(overrides: Partial<Database> = {}) {
  const tables: Database = {
    companies: [
      {id:'alfa',slug:'alfa',status:'active'},
      {id:'beta',slug:'beta',status:'active'},
    ],
    app_profiles: [{user_id:'alfa-user',active:true}],
    company_memberships: [
      {company_id:'alfa',user_id:'alfa-user',role_id:'alfa-owner',active:true},
    ],
    app_roles: [{id:'alfa-owner',company_id:'alfa',key:'owner'}],
    ...overrides,
  };
  const reads: string[] = [];
  const db = {
    from(table: string) {
      reads.push(table);
      const conditions: Array<[string,unknown]> = [];
      const q: any = {
        select: () => q,
        eq: (field: string, value: unknown) => {
          conditions.push([field,value]); return q;
        },
        maybeSingle: async () => ({
          data: (tables[table] ?? []).find(row =>
            conditions.every(([key,value]) => row[key] === value)) ?? null,
          error: null,
        }),
      };
      return q;
    },
  };
  const guard = new TenantAdminAuthorization({getClient:()=>db} as any);
  const check = (companyId='alfa', slug='alfa', userId='alfa-user',
    type='user') => guard.assertCurrentManager(userId,type,companyId,slug);
  return { guard, check, reads };
}

describe('SEG-003B - live server-side tenant administrator authorization', () => {
  it('allows an active owner in Alfa', async () => {
    await expect(harness().check()).resolves.toBeUndefined();
  });
  it('allows an active admin when its role belongs to Alfa', async () => {
    const { check } = harness({
      app_roles:[{id:'alfa-owner',company_id:'alfa',key:'admin'}],
    });
    await expect(check()).resolves.toBeUndefined();
  });
  it('rejects an impersonated Beta tenant before reading user data', async () => {
    const { check, reads } = harness();
    await expect(check('beta','beta')).rejects.toBeInstanceOf(ForbiddenException);
    expect(reads).toEqual(['companies','app_profiles','company_memberships']);
  });
  it('rejects disabled profiles even with an active membership', async () => {
    const { check } = harness({app_profiles:[{user_id:'alfa-user',active:false}]});
    await expect(check()).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('rejects disabled membership', async () => {
    const { check } = harness({company_memberships:[
      {company_id:'alfa',user_id:'alfa-user',role_id:'alfa-owner',active:false},
    ]});
    await expect(check()).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('revokes owner permissions immediately after role is changed', async () => {
    const { check } = harness({app_roles:[
      {id:'alfa-owner',company_id:'alfa',key:'advisor'},
    ]});
    await expect(check()).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('rejects a role belonging to another company', async () => {
    const { check } = harness({app_roles:[
      {id:'alfa-owner',company_id:'beta',key:'owner'},
    ]});
    await expect(check()).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('rejects stale sessions for a deleted user', async () => {
    const { check } = harness({app_profiles:[]});
    await expect(check()).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('rejects company ID / slug mismatch', async () => {
    const { check } = harness();
    await expect(check('alfa','beta')).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('rejects missing identities and bootstrap sessions', async () => {
    const { check } = harness();
    await expect(check('alfa','alfa','','user')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(check('alfa','alfa','alfa-user','bootstrap'))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });
});
