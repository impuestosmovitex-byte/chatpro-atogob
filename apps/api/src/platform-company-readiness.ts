/**
 * MW1 platform Super Admin: read-only onboarding and connector status.
 * "active" provider records mean CONFIGURED, never a successful live send.
 * Do not include credentials, numbers, messages or customers in the output.
 */
export type ConnectorStatus = 'active'|'pending'|'error'|'disconnected';
export type ConnectorSummary={
  key:string; label:string; status:ConnectorStatus;
  meaning:'registered_only'|'pending'|'attention';
};
export type CompanyReadiness={
  stage:'create_owner'|'choose_plan'|'connect_channel'|'verify_real_message'|'ready_for_pilot_review';
  title:string; notes:string[];
  configuredChannels:number; pendingConnectors:number; connectorErrors:number;
  integrations:ConnectorSummary[];
};
export type ReadinessInput={
  activeUsers:number; companyStatus:string;
  planKey:string; whatsappEnabled:boolean;
  instagramEnabled:boolean; messengerEnabled:boolean; aiEnabled:boolean;
  connections:Array<{provider:string;integration_type:string;status:string}>;
};
const KNOWN=[
  {provider:'meta',integration_type:'whatsapp',key:'whatsapp',label:'WhatsApp'},
  {provider:'meta',integration_type:'instagram',key:'instagram',label:'Instagram'},
  {provider:'meta',integration_type:'messenger',key:'messenger',label:'Messenger'},
  {provider:'shopify',integration_type:'store',key:'shopify',label:'Shopify'},
] as const;
const FLAGS={whatsapp:'whatsappEnabled',instagram:'instagramEnabled',
  messenger:'messengerEnabled'} as const;
export function companyReadiness(input:ReadinessInput):CompanyReadiness {
  const integrations:ConnectorSummary[]=KNOWN.flatMap(spec=>{
    const rows=input.connections.filter(c=>c.provider===spec.provider&&
      c.integration_type===spec.integration_type);
    if(!rows.length)return [];
    const status:ConnectorStatus=rows.some(c=>c.status==='active')?'active':
      rows.some(c=>c.status==='error')?'error':
      rows.some(c=>c.status==='pending')?'pending':'disconnected';
    return [{key:spec.key,label:spec.label,status,meaning:
      status==='active'?'registered_only':
      status==='pending'?'pending':'attention'}];
  });
  const channels=integrations.filter(x=>x.key!=='shopify'&&x.status==='active'&&
    input[FLAGS[x.key as keyof typeof FLAGS]]);
  const pending=integrations.filter(x=>x.status==='pending').length;
  const errors=integrations.filter(x=>x.status==='error').length;
  const notes:string[]=[];
  if(input.companyStatus!=='active')notes.push('Empresa no activa.');
  if(input.activeUsers<1)notes.push('No hay usuarios activos registrados.');
  if(!input.planKey||input.planKey==='custom')notes.push('Revisar límites y plan comercial.');
  if(!input.aiEnabled)notes.push('La IA no está habilitada en el plan.');
  if(!channels.length)notes.push('No hay canales de atención activos registrados para este plan.');
  if(errors)notes.push('Hay integraciones con error registrado.');
  if(pending)notes.push('Hay integraciones pendientes de configuración.');
  let stage:CompanyReadiness['stage'];
  if(input.activeUsers<1)stage='create_owner';
  else if(input.companyStatus!=='active'||!input.planKey)stage='choose_plan';
  else if(!channels.length)stage='connect_channel';
  else if(errors||pending)stage='verify_real_message';
  else stage='ready_for_pilot_review';
  const labels:Record<CompanyReadiness['stage'],string>={
    create_owner:'Configurar acceso',
    choose_plan:'Revisar activación y plan',
    connect_channel:'Conectar canal de atención',
    verify_real_message:'Revisar integración y probar mensajes',
    ready_for_pilot_review:'Validar prueba real antes del piloto',
  };
  notes.push('Los estados se calculan a partir de registros, no prueban entrega de mensajes ni funcionamiento de la IA.');
  return {stage,title:labels[stage],notes,configuredChannels:channels.length,
    pendingConnectors:pending,connectorErrors:errors,integrations};
}
