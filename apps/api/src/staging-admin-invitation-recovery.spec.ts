import {createHash} from 'node:crypto';
import {PlatformAdminController} from './platform-admin.controller';

describe('SEG-003C staging admin invitation recovery — no live data',()=>{
 const originalKey=process.env.CHATPRO_INBOX_KEY;
 const originalStaging=process.env.MW1_STAGING_MODE;
 const originalSetup=process.env.MW1_STAGING_ADMIN_SETUP_TOKEN;
 const key='synthetic-internal-key';
 const password='Test-Pass-Only-2026';
 const tokenA='a'.repeat(64),tokenB='b'.repeat(64);
 const digest=(token:string)=>createHash('sha256').update(token).digest('hex');
 let invites:Array<{id:string;token_sha256:string;login_identifier:string;company_slug:string;used_at:string|null;expires_at:string}>;
 let profiles:Array<{user_id:string;login_identifier:string}>;
 let admins:string[];
 let authUsers:Set<string>;
 let counter=0;
 let failCreate=false,failProfile=false,failGrant=false;
 let writes:Array<{table:string;kind:string}>=[];
 const userId='synthetic-admin-id';
 function reset(){
  invites=[tokenA,tokenB].map((token,i)=>({
    id:'invite-'+i,token_sha256:digest(token),
    login_identifier:i===0?'MW1TESTA':'MW1TESTB',
    company_slug:'mw1-demo-mercado',used_at:null,
    expires_at:'2099-01-01T00:00:00.000Z',
  }));
  profiles=[];admins=[];authUsers=new Set();
  counter=0;failCreate=false;failProfile=false;failGrant=false;writes=[];
 }
 const db={
  from(table:string){
   const eqs:Array<[string,unknown]>=[];
   const nulls:string[]=[];
   const gt:Array<[string,string]>=[];
   let mode:'select'|'update'|'delete'='select';
   let change:Record<string,unknown>={};
   const q:any={
    select(_columns:string,_options?:unknown){return q;},
    then(resolve:(value:any)=>unknown,reject?:(reason:any)=>unknown){
      if(mode==='delete'){
        const id=String(eqs.find(([k])=>k==='user_id')?.[1]??'');
        if(table==='platform_admins')admins=admins.filter(x=>x!==id);
        if(table==='app_profiles')profiles=profiles.filter(x=>x.user_id!==id);
        writes.push({table,kind:'delete'});
      }
      return Promise.resolve(table==='platform_admins'
        ?{count:admins.length,error:null}:{error:null}).then(resolve,reject);
    },
    update(value:Record<string,unknown>){mode='update';change=value;return q;},
    delete(){mode='delete';return q;},
    eq(field:string,value:unknown){eqs.push([field,value]);return q;},
    is(field:string,value:null){if(value===null)nulls.push(field);return q;},
    gt(field:string,value:string){gt.push([field,value]);return q;},
    async maybeSingle(){
      if(table==='platform_staging_admin_invites'){
        const matching=invites.find(row=>
          eqs.every(([k,v])=>(row as any)[k]===v)&&
          nulls.every(k=>(row as any)[k]===null)&&
          gt.every(([k,v])=>String((row as any)[k])>v)
        );
        if(matching&&mode==='update'){
          matching.used_at=String(change.used_at);
          writes.push({table,kind:'claim'});
        }
        if(mode==='update')return {data:matching?{...matching}:null,error:null};
        return {data:matching?{...matching}:null,error:null};
      }
      if(table==='app_profiles'){
        const identifier=eqs.find(([k])=>k==='login_identifier')?.[1];
        return {data:profiles.find(row=>row.login_identifier===identifier)??null,error:null};
      }
      return {data:null,error:null};
    },
    async insert(value:Record<string,unknown>){
      writes.push({table,kind:'insert'});
      if(table==='app_profiles'){
        if(failProfile)return {error:{message:'synthetic profile failure'}};
        profiles.push({user_id:String(value.user_id),login_identifier:String(value.login_identifier)});
      }else if(table==='platform_admins'){
        if(failGrant)return {error:{message:'synthetic grant failure'}};
        admins.push(String(value.user_id));
      }
      return {error:null};
    },
  };
   return q;
  },
  auth:{admin:{
    async createUser(){
      counter++;
      if(failCreate)return {data:{user:null},error:{message:'synthetic auth failure'}};
      const id=userId+'-'+counter;
      authUsers.add(id);
      return {data:{user:{id}},error:null};
    },
    async deleteUser(id:string){authUsers.delete(id);return {error:null};},
  }},
 };
 const controller=new PlatformAdminController({getClient:()=>db} as any,{hash:()=> 'synthetic-password-hash'} as any);
 const activate=(token:string,pass=password)=>controller.activateStagingSuperadmin(key,{token,password:pass});
 beforeEach(()=>{
  process.env.CHATPRO_INBOX_KEY=key;
  process.env.MW1_STAGING_MODE='true';
  delete process.env.MW1_STAGING_ADMIN_SETUP_TOKEN;
  reset();
 });
 afterAll(()=>{
  if(originalKey===undefined)delete process.env.CHATPRO_INBOX_KEY;
  else process.env.CHATPRO_INBOX_KEY=originalKey;
  if(originalStaging===undefined)delete process.env.MW1_STAGING_MODE;
  else process.env.MW1_STAGING_MODE=originalStaging;
  if(originalSetup===undefined)delete process.env.MW1_STAGING_ADMIN_SETUP_TOKEN;
  else process.env.MW1_STAGING_ADMIN_SETUP_TOKEN=originalSetup;
 });
 it('keeps invitation unused if password includes the identifier',async()=>{
  await expect(activate(tokenA,'MW1TESTA-Password-2026')).rejects.toThrow('identificación');
  expect(invites[0].used_at).toBeNull();
  expect(writes).toEqual([]);
 });
 it('keeps invitation unused when identifier is already taken',async()=>{
  profiles.push({user_id:'existing-user',login_identifier:'MW1TESTA'});
  await expect(activate(tokenA)).rejects.toThrow('registrado');
  expect(invites[0].used_at).toBeNull();
  expect(writes).toEqual([]);
 });
 it('burns a claimed invitation after a failed Auth call; retry is blocked',async()=>{
  failCreate=true;
  await expect(activate(tokenA)).rejects.toThrow('se requiere una nueva');
  expect(invites[0].used_at).toBeTruthy();
  expect(writes.filter(x=>x.kind==='claim')).toHaveLength(1);
  failCreate=false;
  await expect(activate(tokenA)).rejects.toThrow('inválido');
  expect(authUsers.size).toBe(0);
 });
 it('permits a newly issued distinct invitation following an incomplete attempt',async()=>{
  failCreate=true;
  await expect(activate(tokenA)).rejects.toThrow('se requiere una nueva');
  failCreate=false;
  const result=await activate(tokenB);
  expect(result.ok).toBe(true);
  expect(invites.every(invite=>Boolean(invite.used_at))).toBe(true);
  expect(admins).toHaveLength(1);
 });
 it('deletes synthetic Auth identity and profile on grant failure; invite stays used',async()=>{
  failGrant=true;
  await expect(activate(tokenA)).rejects.toThrow('se requiere una nueva');
  expect(invites[0].used_at).toBeTruthy();
  expect(authUsers.size).toBe(0);
  expect(profiles).toHaveLength(0);
  expect(admins).toHaveLength(0);
 });
 it('blocks further activation after first admin is active',async()=>{
  const created=await activate(tokenA);
  expect(created.ok).toBe(true);
  await expect(activate(tokenB)).rejects.toThrow('completada');
  expect(invites[1].used_at).toBeNull();
 });
 it('fails closed outside staging and without internal key',async()=>{
  await expect(controller.activateStagingSuperadmin('wrong',{token:tokenA,password}))
   .rejects.toThrow();
  process.env.MW1_STAGING_MODE='false';
  await expect(activate(tokenA)).rejects.toThrow('staging');
  expect(invites[0].used_at).toBeNull();
 });
});
