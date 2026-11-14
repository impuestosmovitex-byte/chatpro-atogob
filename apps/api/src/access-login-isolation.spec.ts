import {AccessController} from './access.controller';
import {UnauthorizedException} from '@nestjs/common';
import {verifyInternalAttestation} from './internal-attestation';

jest.mock('./internal-attestation',()=>({
 verifyInternalAttestation:jest.fn(),
}));

const slug='empresa-a';
function fixture({active=true,membershipActive=true,roleCompany='company-a',company='company-a',membershipCompany='company-a'}={}){
 const calls:Array<{table:string;filters:Record<string,unknown>}>=[];
 const rows:Record<string,any>={
  companies:company==='company-a'?{id:'company-a',name:'Empresa A',slug,status:'active'}:null,
  app_profiles:{user_id:'user-1',full_name:'Prueba',login_identifier:'OWNER01',password_hash:'stored',active},
  company_memberships:{company_id:membershipCompany, user_id:'user-1',role_id:'role-1',active:membershipActive},
  app_roles:{id:'role-1',key:'owner',name:'Propietario',company_id:roleCompany},
  platform_admins:null
 };
 const db={from:(table:string)=>{
  const filters:Record<string,unknown>={};calls.push({table,filters});
  const chain:any={
   select:()=>chain,eq:(key:string,value:unknown)=>{filters[key]=value;return chain;},
   maybeSingle:async()=>({data:rows[table] && Object.entries(filters).every(([key,value])=>rows[table][key]===value) ? rows[table] : null,error:null})
  };return chain;
 }};
 const controller=new AccessController({getClient:()=>db} as any,
  {verify:(password:string)=>password==='correct'} as any);
 return {controller,calls};
}
describe('MW1 enterprise login isolation',()=>{
 const previous=process.env.CHATPRO_INBOX_KEY;
 beforeAll(()=>{process.env.CHATPRO_INBOX_KEY='test-internal-key';});
 afterAll(()=>{if(previous===undefined)delete process.env.CHATPRO_INBOX_KEY;else process.env.CHATPRO_INBOX_KEY=previous;});
 test('allows active owner only inside the matching company',async()=>{
  const {controller,calls}=fixture();
  const out=await controller.login('test-internal-key',slug,{identifier:'OWNER01',password:'correct'});
  expect(out.session).toMatchObject({type:'user',companyId:'company-a',roleKey:'owner'});
  expect(calls.find(c=>c.table==='company_memberships')?.filters).toMatchObject({company_id:'company-a',user_id:'user-1'});
 });
 test('rejects a disabled profile',async()=>{
  const {controller}=fixture({active:false});
  await expect(controller.login('test-internal-key',slug,{identifier:'OWNER01',password:'correct'})).rejects.toThrow(UnauthorizedException);
 });
 test('rejects a disabled membership',async()=>{
  const {controller}=fixture({membershipActive:false});
  await expect(controller.login('test-internal-key',slug,{identifier:'OWNER01',password:'correct'})).rejects.toThrow(UnauthorizedException);
 });
 test('rejects a role associated with another company',async()=>{
  const {controller}=fixture({roleCompany:'company-b'});
  await expect(controller.login('test-internal-key',slug,{identifier:'OWNER01',password:'correct'})).rejects.toThrow(UnauthorizedException);
 });
 test('rejects membership from another tenant even with a valid password',async()=>{
  const {controller}=fixture({membershipCompany:'company-b'});
  await expect(controller.login('test-internal-key',slug,{identifier:'OWNER01',password:'correct'})).rejects.toThrow();
 });
 test('does not allow an invalid password',async()=>{
  const {controller}=fixture();
  await expect(controller.login('test-internal-key',slug,{identifier:'OWNER01',password:'wrong'})).rejects.toThrow(UnauthorizedException);
 });
});

describe('SEG-003 staging: revocation during company listing and switch',()=>{
 const prevKey=process.env.CHATPRO_INBOX_KEY;
 const prevMode=process.env.MW1_STAGING_MODE;
 beforeAll(()=>{
  process.env.CHATPRO_INBOX_KEY='test-internal-key';
  process.env.MW1_STAGING_MODE='true';
 });
 afterAll(()=>{
  if(prevKey===undefined) delete process.env.CHATPRO_INBOX_KEY;
  else process.env.CHATPRO_INBOX_KEY=prevKey;
  if(prevMode===undefined) delete process.env.MW1_STAGING_MODE;
  else process.env.MW1_STAGING_MODE=prevMode;
 });
 beforeEach(()=>jest.clearAllMocks());
 it('does not list companies for a disabled profile with a still-active membership',async()=>{
  const {controller}=fixture({active:false,membershipActive:true});
  await expect(controller.companies('test-internal-key','user-1')).rejects.toThrow(UnauthorizedException);
 });
 it('does not issue a new company session for a disabled profile with active membership',async()=>{
  const {controller}=fixture({active:false,membershipActive:true});
  await expect(controller.switchCompany('test-internal-key','signed-staging-proof','company-a','empresa-a',
   {userId:'user-1',companySlug:'empresa-a'})).rejects.toThrow(UnauthorizedException);
  expect(verifyInternalAttestation).toHaveBeenCalledTimes(1);
 });
 it('keeps a valid signed switch working for an active profile and active membership',async()=>{
  const {controller}=fixture({active:true,membershipActive:true});
  const out=await controller.switchCompany('test-internal-key','signed-staging-proof','company-a','empresa-a',
   {userId:'user-1',companySlug:'empresa-a'});
  expect(out).toMatchObject({ok:true,session:{type:'user',userId:'user-1',companyId:'company-a',roleKey:'owner'}});
 });
 it('rejects an active profile whose destination company membership was revoked',async()=>{
  const {controller}=fixture({active:true,membershipActive:false});
  await expect(controller.switchCompany('test-internal-key','signed-staging-proof','company-a','empresa-a',
   {userId:'user-1',companySlug:'empresa-a'})).rejects.toThrow(UnauthorizedException);
 });
 it('rejects a tenant role belonging to another company on signed switch',async()=>{
  const {controller}=fixture({active:true,membershipActive:true,roleCompany:'company-b'});
  await expect(controller.switchCompany('test-internal-key','signed-staging-proof','company-a','empresa-a',
   {userId:'user-1',companySlug:'empresa-a'})).rejects.toThrow(UnauthorizedException);
 });
});
