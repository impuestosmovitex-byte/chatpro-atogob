import {StagingDemoRequestsController} from './staging-demo-requests.controller';
import {SupabaseService} from './supabase.service';

describe('Isolated staging commercial demo intake',()=>{
  const prevStaging=process.env.MW1_STAGING_MODE;
  const prevKey=process.env.CHATPRO_INBOX_KEY;
  let controller:StagingDemoRequestsController;
  let insert:jest.Mock;
  let count:number;
  const data={
    companyName:'Tienda Beta',contactName:'Persona Prueba',
    contactEmail:'pruebas@example.org',planInterest:'eco',
    visitorDigest:'b'.repeat(64),consent:true,
  };
  beforeEach(()=>{
    process.env.MW1_STAGING_MODE='true';
    process.env.CHATPRO_INBOX_KEY='internal-test-value';
    count=0;insert=jest.fn().mockResolvedValue({error:null});
    const db={getClient:()=>({
      from:(table:string)=>{
        if(table!=='platform_demo_requests')throw Error('wrong table');
        return {
          select:()=>({eq:()=>({gte:()=>Promise.resolve({count,error:null})})}),
          insert,
        };
      },
    })};
    controller=new StagingDemoRequestsController(db as unknown as SupabaseService);
  });
  afterAll(()=>{
    if(prevStaging===undefined)delete process.env.MW1_STAGING_MODE;
    else process.env.MW1_STAGING_MODE=prevStaging;
    if(prevKey===undefined)delete process.env.CHATPRO_INBOX_KEY;
    else process.env.CHATPRO_INBOX_KEY=prevKey;
  });
  test('accepts valid explicit consent but never creates accounts',async()=>{
    const res=await controller.submit('internal-test-value',data);
    expect(res.ok).toBe(true);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0]).toMatchObject({
      company_name:'Tienda Beta',plan_interest:'pro',status:'new',
    });
    expect(JSON.stringify(res)).not.toContain('pruebas@example.org');
  });
  test('maps commercial names to legacy storage without modifying entitlements',async()=>{
    await controller.submit('internal-test-value',{...data,planInterest:'pro'});
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({plan_interest:'empresa'}));
  });
  test('rejects invalid or absent consent',async()=>{
    await expect(controller.submit('internal-test-value',{...data,consent:false}))
      .rejects.toThrow(/autoriza/);
    expect(insert).not.toHaveBeenCalled();
  });
  test('rejects incorrect shared secret',async()=>{
    await expect(controller.submit('incorrect-key',data)).rejects.toThrow('No autorizado');
    expect(insert).not.toHaveBeenCalled();
  });
  test('does not run in production',async()=>{
    process.env.MW1_STAGING_MODE='false';
    await expect(controller.submit('internal-test-value',data)).rejects.toThrow(/solo/);
    expect(insert).not.toHaveBeenCalled();
  });
  test('rejects unapproved plan names and non-hex visitor tokens',async()=>{
    await expect(controller.submit('internal-test-value',{...data,planInterest:'pago_verificado'}))
      .rejects.toThrow(/Completa/);
    await expect(controller.submit('internal-test-value',{...data,visitorDigest:'secret'}))
      .rejects.toThrow(/Completa/);
    expect(insert).not.toHaveBeenCalled();
  });
  test('records a guided 14-day trial with plan and WhatsApp readiness but no active subscription',async()=>{
    const result=await controller.submit('internal-test-value',{...data,
      requestType:'trial',contactPhone:'+573001112233',whatsappSetup:'business_app'});
    expect(result.ok).toBe(true);
    expect(result.message).toContain('todavía no ha comenzado');
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      source:'web_trial',status:'new',plan_interest:'pro',
      contact_phone:'+573001112233',whatsapp_setup:'business_app',
      trial_requested_days:14,
    }));
    expect(JSON.stringify(insert.mock.calls[0][0])).not.toContain('trial_activated_at');
  });
  test('rejects trial without legitimate phone and connection assessment',async()=>{
    await expect(controller.submit('internal-test-value',{...data,requestType:'trial',
      contactPhone:'',whatsappSetup:'business_app'})).rejects.toThrow(/número/);
    await expect(controller.submit('internal-test-value',{...data,requestType:'trial',
      contactPhone:'3001112233',whatsappSetup:'approved_without_review'})).rejects.toThrow(/WhatsApp/);
    expect(insert).not.toHaveBeenCalled();
  });
  test('rejects unsupported commercial request type',async()=>{
    await expect(controller.submit('internal-test-value',{...data,requestType:'activate-paid'}))
      .rejects.toThrow(/Tipo de solicitud/);
    expect(insert).not.toHaveBeenCalled();
  });
  test('rate limits without exposing whether email already exists',async()=>{
    count=3;
    const result=await controller.submit('internal-test-value',data);
    expect(result.ok).toBe(true);
    expect(insert).not.toHaveBeenCalled();
  });
});
