import {companyReadiness} from './platform-company-readiness';

describe('MW1 platform Super Admin onboarding overview',()=>{
  const input={
    activeUsers:1,companyStatus:'active',planKey:'pro',
    whatsappEnabled:true,instagramEnabled:false,messengerEnabled:false,
    aiEnabled:true,connections:[
      {provider:'meta',integration_type:'whatsapp',status:'active'},
      {provider:'shopify',integration_type:'store',status:'active'},
    ],
  };
  it('shows configured connectors but requires live message verification',()=>{
    const status=companyReadiness(input);
    expect(status.stage).toBe('ready_for_pilot_review');
    expect(status.configuredChannels).toBe(1);
    expect(status.integrations.map(i=>i.label)).toContain('Shopify');
    expect(status.integrations.find(i=>i.key==='whatsapp')?.meaning)
      .toBe('registered_only');
    expect(status.notes.join(' ')).toContain('no prueban entrega');
  });
  it('does not count channels excluded by a plan',()=>{
    const status=companyReadiness({...input,whatsappEnabled:false});
    expect(status.stage).toBe('connect_channel');
    expect(status.configuredChannels).toBe(0);
  });
  it('asks to create a member if no active owners or advisors exist',()=>{
    const status=companyReadiness({...input,activeUsers:0,connections:[]});
    expect(status.stage).toBe('create_owner');
    expect(status.notes.join(' ')).toContain('No hay usuarios');
  });
  it('handles pending and error channels without treating them as healthy',()=>{
    const status=companyReadiness({...input,connections:[
      {provider:'meta',integration_type:'whatsapp',status:'error'},
      {provider:'meta',integration_type:'instagram',status:'pending'},
    ]});
    expect(status.configuredChannels).toBe(0);
    expect(status.pendingConnectors).toBe(1);
    expect(status.connectorErrors).toBe(1);
    expect(status.stage).toBe('connect_channel');
  });
  it('never outputs provider secrets or client messages',()=>{
    const bad={...input,connections:[
      {provider:'meta',integration_type:'whatsapp',status:'active',
        credential:'SECRET_DO_NOT_EXPORT',phone:'+570000000000'},
    ]};
    const response=JSON.stringify(companyReadiness(bad));
    expect(response).not.toContain('SECRET_DO_NOT_EXPORT');
    expect(response).not.toContain('+570000000000');
  });
  it('does not invent a configured channel when no connection exists',()=>{
    const status=companyReadiness({...input,connections:[]});
    expect(status.configuredChannels).toBe(0);
    expect(status.stage).toBe('connect_channel');
  });
});
