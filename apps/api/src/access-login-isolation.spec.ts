import {AccessController} from './access.controller';
import {UnauthorizedException} from '@nestjs/common';

const slug='empresa-a';
function fixture({active=true,membershipActive=true,roleCompany='company-a',company='company-a'}={}){
 const calls:Array<{table:string;filters:Record<string,unknown>}>=[];
 const rows:Record<string,any>={
  companies:company==='company-a'?{id:'company-a',name:'Empresa A',slug}:null,
  app_profiles:{user_id:'user-1',full_name:'Prueba',login_identifier:'OWNER01',password_hash:'stored',active},
  company_memberships:{user_id:'user-1',role_id:'role-1',active:membershipActive},
  app_roles:{id:'role-1',key:'owner',name:'Propietario',company_id:roleCompany},
  platform_admins:null
 };
 const db={from:(table:string)=>{
  const filters:Record<string,unknown>={};calls.push({table,filters});
  const chain:any={
   select:()=>chain,eq:(key:string,value:unknown)=>{filters[key]=value;return chain;},
   maybeSingle:async()=>({data:rows[table],error:null})
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
 test('does not allow an invalid password',async()=>{
  const {controller}=fixture();
  await expect(controller.login('test-internal-key',slug,{identifier:'OWNER01',password:'wrong'})).rejects.toThrow(UnauthorizedException);
 });
});
