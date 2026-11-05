import { SupabaseService } from './supabase.service';
import {
  StagingMessengerOAuthAuthorizedNonceService,
  type MessengerNonceRequest,
} from './staging-messenger-oauth-authorized-nonce.service';

describe('MW1 Messenger staging: recheck membership and role before nonce DB access', () => {
  const companyId='11111111-1111-4111-8111-111111111111';
  const userId='22222222-2222-4222-8222-222222222222';
  const request: MessengerNonceRequest = {
    internalKey: 'synthetic-private-mw1-server-key',
    companyId, userId, companySlug:'piloto-mw1-prueba',
  };
  const nonceHash='f'.repeat(64);
  const envBefore = {
    url: process.env.SUPABASE_URL,
    key: process.env.CHATPRO_INBOX_KEY,
  };
  const tables: Record<string, Record<string, unknown>>={
    companies:{id:companyId,slug:'piloto-mw1-prueba',status:'active'},
    company_memberships:{company_id:companyId,user_id:userId,active:true,role_id:'owner-role'},
    app_roles:{id:'owner-role',key:'owner',company_id:null},
  };
  const errors: Record<string, unknown> = {};
  const seen: string[]=[];
  const insert=jest.fn();
  const rpc=jest.fn();
  let service:StagingMessengerOAuthAuthorizedNonceService;

  beforeEach(() => {
    process.env.SUPABASE_URL='https://zqfbxqszfnrbwpfukwak.supabase.co';
    process.env.CHATPRO_INBOX_KEY=request.internalKey;
    Object.keys(errors).forEach(k=>delete errors[k]);
    tables.companies={id:companyId,slug:'piloto-mw1-prueba',status:'active'};
    tables.company_memberships={company_id:companyId,user_id:userId,active:true,role_id:'owner-role'};
    tables.app_roles={id:'owner-role',key:'owner',company_id:null};
    seen.length=0;
    insert.mockReset().mockResolvedValue({error:null});
    rpc.mockReset().mockResolvedValue({data:true,error:null});

    const db={
      from:(table:string)=>{
        seen.push(table);
        if(table==='mw1_messenger_oauth_nonces')return {insert};
        const filters:Record<string,unknown>={};
        const chain={
          select:(_fields:string)=>chain,
          eq:(name:string,value:unknown)=>{filters[name]=value;return chain;},
          maybeSingle:async()=>{
            const row=tables[table];
            const match=row && Object.entries(filters).every(([k,v])=>row[k]===v);
            return {data:match?row:null,error:errors[table]??null};
          },
        };
        return chain;
      },
      rpc:(name:string,payload:unknown)=>{seen.push(name);return rpc(name,payload);},
    };
    service=new StagingMessengerOAuthAuthorizedNonceService({
      getClient:()=>db,
    } as unknown as SupabaseService);
  });

  afterAll(()=>{
    if(envBefore.url===undefined)delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL=envBefore.url;
    if(envBefore.key===undefined)delete process.env.CHATPRO_INBOX_KEY;
    else process.env.CHATPRO_INBOX_KEY=envBefore.key;
  });

  const expectDenied=async(update:MessengerNonceRequest=request)=>{
    await expect(service.register(update,nonceHash)).rejects.toThrow();
    await expect(service.consume(update,nonceHash)).rejects.toThrow();
    expect(seen).not.toContain('mw1_messenger_oauth_nonces');
    expect(seen).not.toContain('mw1_consume_messenger_oauth_nonce');
    expect(insert).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  };

  it('checks company membership and admin role before registering a nonce hash',async()=>{
    await service.register(request,nonceHash);
    expect(seen).toEqual([
      'companies','company_memberships','app_roles','mw1_messenger_oauth_nonces',
    ]);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      nonce_hash:nonceHash,company_id:companyId,user_id:userId,
    }));
    expect(rpc).not.toHaveBeenCalled();
  });

  it('performs a fresh membership check before atomically consuming the nonce',async()=>{
    await service.consume(request,nonceHash);
    expect(seen).toEqual([
      'companies','company_memberships','app_roles','mw1_consume_messenger_oauth_nonce',
    ]);
    expect(rpc).toHaveBeenCalledWith('mw1_consume_messenger_oauth_nonce',{
      p_nonce_hash:nonceHash,p_company_id:companyId,p_user_id:userId,
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it('permits active company-scoped admins, not just owners',async()=>{
    tables.app_roles={id:'owner-role',key:'admin',company_id:companyId};
    await service.register(request,nonceHash);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('denies a changed or missing internal service key without any DB reads',async()=>{
    await expectDenied({...request,internalKey:'wrong-key'});
    await expectDenied({...request,internalKey:''});
    expect(seen).toEqual([]);
  });

  it('denies an absent server secret before database access',async()=>{
    delete process.env.CHATPRO_INBOX_KEY;
    await expectDenied();
    expect(seen).toEqual([]);
  });

  it('denies all non-staging Supabase targets before database access',async()=>{
    process.env.SUPABASE_URL='https://ynmwgerlfidwsihmzgkw.supabase.co';
    await expectDenied();
    process.env.SUPABASE_URL='https://example.invalid';
    await expectDenied();
    expect(seen).toEqual([]);
  });

  it('denies wrong tenant slug, company ID or user ID without querying data',async()=>{
    await expectDenied({...request,companySlug:'atogob'});
    await expectDenied({...request,companyId:'bad'});
    await expectDenied({...request,userId:'bad'});
    expect(seen).toEqual([]);
  });

  it('denies inactive, missing or foreign companies before membership lookup',async()=>{
    tables.companies={id:companyId,slug:'piloto-mw1-prueba',status:'disabled'};
    await expectDenied();
    delete tables.companies;
    await expectDenied();
    tables.companies={id:companyId,slug:'piloto-mw1-prueba',status:'active'};
    errors.companies={message:'fake-db-error'};
    await expectDenied();
    expect(seen.every(x=>x==='companies')).toBe(true);
  });

  it('denies missing, revoked and cross-tenant membership',async()=>{
    delete tables.company_memberships;
    await expectDenied();
    tables.company_memberships={company_id:companyId,user_id:userId,active:false,role_id:'owner-role'};
    await expectDenied();
    tables.company_memberships={company_id:companyId,user_id:'99999999-9999-4999-8999-999999999999',active:true,role_id:'owner-role'};
    await expectDenied();
    expect(seen).not.toContain('app_roles');
  });

  it('denies missing role, read errors, viewers and cross-company roles',async()=>{
    delete tables.app_roles;
    await expectDenied();
    tables.app_roles={id:'owner-role',key:'viewer',company_id:null};
    await expectDenied();
    tables.app_roles={id:'owner-role',key:'owner',company_id:'99999999-9999-4999-8999-999999999999'};
    await expectDenied();
    tables.app_roles={id:'owner-role',key:'owner',company_id:null};
    errors.app_roles={message:'fake-role-query-error'};
    await expectDenied();
  });

  it('does not allow registration or consumption if the membership is revoked between calls',async()=>{
    await service.register(request,nonceHash);
    tables.company_memberships={company_id:companyId,user_id:userId,active:false,role_id:'owner-role'};
    await expect(service.consume(request,nonceHash)).rejects.toThrow(/no pertenece/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('never exchanges Meta tokens, activates messaging or exposes a controller',()=>{
    expect(service).not.toHaveProperty('oauthCallback');
    expect(service).not.toHaveProperty('enableMessaging');
    expect(service).not.toHaveProperty('subscribeWebhooks');
  });
});
