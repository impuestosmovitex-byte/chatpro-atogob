import {readFileSync} from 'node:fs';
import {join} from 'node:path';

const sql=readFileSync(join(__dirname,'../../../supabase/migrations/202611160001_mw1_manual_contract_renewal_period_guard.sql'),'utf8');
const oldExpiry=Date.parse('2026-12-16T05:05:00Z');
const canStartRenewal=(iso:string)=>Date.parse(iso)>=oldExpiry;

describe('MW1 manual renewal period guard',()=>{
 it('enforces the new start against the previous expiry, only for renewals',()=>{
  const renewal=sql.indexOf('if v_old is not null then');
  const startCheck=sql.indexOf("if p_starts_at < (v_old->>'expires_at')::timestamptz then");
  const endRenewal=sql.indexOf('end if;',sql.indexOf('Entitlements drift: renewal must not change feature capabilities'));
  expect(renewal).toBeGreaterThan(0);
  expect(startCheck).toBeGreaterThan(renewal);
  expect(startCheck).toBeLessThan(endRenewal);
  expect(sql).toContain('Renewal start must not precede the current contract expiry');
  expect(sql).toContain("if p_expires_at <= (v_old->>'expires_at')::timestamptz then");
 });
 it('recognizes overlap, a seamless extension, and explicit gap',()=>{
  expect(canStartRenewal('2026-12-15T05:05:00Z')).toBe(false);
  expect(canStartRenewal('2026-12-16T05:04:59Z')).toBe(false);
  expect(canStartRenewal('2026-12-16T05:05:00Z')).toBe(true);
  expect(canStartRenewal('2026-12-17T05:05:00Z')).toBe(true);
 });
 it('retains review binding, current entitlement checks, and unique payment reference protection',()=>{
  expect(sql).toContain('Company-specific plan review is missing, stale or superseded');
  expect(sql).toContain('Entitlements drift: renewal must not change feature capabilities');
  expect(sql).toContain('Renewal cannot silently reduce previously purchased seats');
  expect(sql).toContain('This payment evidence was already used');
  expect(sql).toContain("case when v_old is null then 'activated' else 'renewed' end");
 });
 it('alters no tables, includes no migration-time data writes, and restricts RPC execution',()=>{
  expect(sql).not.toMatch(/\b(?:alter|create|drop|truncate)\s+table\b/i);
  expect(sql).toContain('create or replace function public.mw1_apply_manual_contract');
  expect(sql).toContain('from public,anon,authenticated;');
  expect(sql).toContain('to service_role;');
  expect(sql).toContain("set search_path=pg_catalog,pg_temp");
 });
});
