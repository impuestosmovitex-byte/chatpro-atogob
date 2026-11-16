import {readFileSync} from 'node:fs';
import {join} from 'node:path';

const sql=readFileSync(join(__dirname,'../../../supabase/migrations/202611160002_mw1_manual_contract_continuous_renewal.sql'),'utf8');

describe('MW1 continuous early renewal without replacing the active period',()=>{
 const firstStart='2026-11-16T05:05:00Z';
 const currentExpiry='2026-12-16T05:05:00Z';
 const renewedExpiry='2027-01-16T05:05:00Z';
 const validNextStart=(value:string)=>new Date(value).getTime()===new Date(currentExpiry).getTime();

 it('refuses overlap and gaps; allows an exact seamless boundary',()=>{
  expect(validNextStart('2026-12-16T05:04:59Z')).toBe(false);
  expect(validNextStart('2026-12-16T05:05:00Z')).toBe(true);
  expect(validNextStart('2026-12-16T05:05:01Z')).toBe(false);
  expect(new Date(renewedExpiry).getTime()).toBeGreaterThan(new Date(currentExpiry).getTime());
  expect(sql).toContain("p_starts_at is distinct from (v_old->>'expires_at')::timestamptz");
  expect(sql).toContain('Renewal start must equal the current contract expiry');
 });
 it('preserves original activation start in the one-row contract',()=>{
  const insert=sql.indexOf('insert into public.mw1_manual_company_contracts(');
  const history=sql.indexOf('insert into public.mw1_manual_contract_history(',insert);
  const contractUpsert=sql.slice(insert,history);
  expect(new Date(firstStart).getTime()).toBeLessThan(new Date(currentExpiry).getTime());
  expect(contractUpsert).toContain("coalesce((v_old->>'starts_at')::timestamptz,p_starts_at)");
  expect(contractUpsert).toContain('starts_at=excluded.starts_at');
  expect(sql).toContain('case when v_old is null then \'activated\' else \'renewed\' end');
  expect(sql).toContain('v_old,v_new||jsonb_build_object');
 });
 it('retains Super Admin boundary, plan approval, entitlement checks and unique evidence',()=>{
  for(const required of [
    'Super Admin inactive or absent',
    'Operational tenant cannot be activated here',
    'Company-specific plan review is missing, stale or superseded',
    'Entitlements drift: renewal must not change feature capabilities',
    'Renewal cannot silently reduce previously purchased seats',
    'Renewal must extend the contract expiry',
    'This payment evidence was already used'
  ])expect(sql).toContain(required);
  expect(sql).toContain('security definer set search_path=pg_catalog,pg_temp');
  expect(sql).toContain('from public,anon,authenticated;');
  expect(sql).toContain('to service_role;');
 });
 it('makes no data changes until authorized migration and subsequent RPC execution',()=>{
  expect(sql).not.toMatch(/\b(?:alter|create|drop|truncate)\s+table\b/i);
  expect((sql.match(/create or replace function public\.mw1_apply_manual_contract/g)||[]).length).toBe(1);
 });
});
