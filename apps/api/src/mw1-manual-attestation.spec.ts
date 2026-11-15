import {createHash,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {verifyManualAdminAttestation} from './mw1-manual-attestation';

const keys=generateKeyPairSync('ed25519');
const original=process.env.MW1_INTERNAL_ATTESTATION_PUBLIC_KEY;
beforeAll(()=>{process.env.MW1_INTERNAL_ATTESTATION_PUBLIC_KEY=keys.publicKey.export({format:'pem',type:'spki'}).toString();});
afterAll(()=>{if(original===undefined)delete process.env.MW1_INTERNAL_ATTESTATION_PUBLIC_KEY;
 else process.env.MW1_INTERNAL_ATTESTATION_PUBLIC_KEY=original;});
function assertion(userId='11111111-1111-4111-8111-111111111111',body:unknown={companyId:'test'},time=Date.now()){
 const iat=Math.floor(time/1000);
 const canonical=(x:unknown):string=>{
  if(x===null||typeof x!=='object')return JSON.stringify(x);
  if(Array.isArray(x))return '['+x.map(canonical).join(',')+']';
  const obj=x as Record<string,unknown>;
  return '{'+Object.keys(obj).sort().map(k=>JSON.stringify(k)+':'+canonical(obj[k])).join(',')+'}';
 };
 const signed={v:1,kind:'platform',userId,companyId:'',companySlug:'',
  method:'POST',path:'/platform-admin/manual-company-contract',iat,exp:iat+20,
  nonce:randomBytes(16).toString('hex'),bodyHash:createHash('sha256').update(canonical(body)).digest('hex')};
 const encoded=Buffer.from(JSON.stringify(signed)).toString('base64url');
 return encoded+'.'+sign(null,Buffer.from(encoded),keys.privateKey).toString('base64url');
}
describe('manual contract signed Super Admin boundary',()=>{
 const userId='11111111-1111-4111-8111-111111111111',body={companyId:'test'};
 it('accepts a matching signature and body',()=>{
  expect(()=>verifyManualAdminAttestation({signature:assertion(),userId,method:'POST',
   path:'/platform-admin/manual-company-contract',body})).not.toThrow();
 });
 it('rejects forged user, body, path, signature and expiry',()=>{
  const token=assertion();
  for(const patch of [
   {userId:'22222222-2222-4222-8222-222222222222'},
   {body:{companyId:'other'}},{path:'/platform-admin/company-plan-activation-review'},
   {signature:token.slice(0,-2)+'XX'}
  ])expect(()=>verifyManualAdminAttestation({signature:token,userId,method:'POST',
   path:'/platform-admin/manual-company-contract',body,...patch})).toThrow();
  expect(()=>verifyManualAdminAttestation({signature:assertion(userId,body,Date.now()-60000),
   userId,method:'POST',path:'/platform-admin/manual-company-contract',body})).toThrow();
 });
});
describe('contract review timestamp precision regression',()=>{
 const patch=readFileSync(join(__dirname,'../../../supabase/migrations/202611150001_mw1_manual_contract_review_timestamp_fix.sql'),'utf8');
 it('preserves exact review binding while normalizing JS microsecond padding',()=>{
  expect(patch).toContain("to_char(v_assignment.updated_at at time zone 'UTC','YYYY-MM-DD\\\"T\\\"HH24:MI:SS.MS') || '000'");
  expect(patch).toContain("to_char(v_draft.updated_at at time zone 'UTC','YYYY-MM-DD\\\"T\\\"HH24:MI:SS.MS') || '000'");
  expect(patch).toContain("Company-specific plan review is missing, stale or superseded");
 });
 it('does not change existing table structures or activate contracts',()=>{
  expect(patch).not.toMatch(/\\balter\\s+table\\b/i);
  expect(patch).not.toMatch(/\\bupdate\\s+public\\.mw1_plan_activation_audit\\b/i);
  expect(patch).toMatch(/create or replace function public\\.mw1_apply_manual_contract/i);
 });
});
describe('staging SQL contract guardrails',()=>{
 const file=readFileSync(join(__dirname,'../../../supabase/migrations/202611140001_mw1_manual_contract_staging.sql'),'utf8');
 it('does not modify existing audit table or insert its forbidden action',()=>{
  expect(file).not.toMatch(/insert into public\.mw1_plan_activation_audit/i);
  expect(file).not.toMatch(/alter table public\.mw1_plan_activation_audit/i);
  expect(file).toMatch(/insert into public\.mw1_manual_contract_history/i);
 });
 it('requires protected role, excludes operational tenants, and guards reviews',()=>{
  expect(file).toContain("current_setting('request.jwt.claim.role',true)");
  expect(file).toContain("set search_path=pg_catalog,pg_temp");
  expect(file).toContain("company_slug=v_company.slug");
  expect(file).toContain('assignmentUpdatedAt');
  expect(file).toContain('draftUpdatedAt');
  expect(file).toContain('Renewal cannot silently reduce previously purchased seats');
 });
 it('requires unique references for all historical payments',()=>{
  expect(file).toMatch(/payment_reference text not null unique/g);
  expect(file).toContain('where payment_reference=p_payment_reference');
 });
});
