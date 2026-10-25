'use client';
import {useEffect,useState} from 'react';
import {calculateIntroductoryMonths} from '../../lib/mw1-subscription-pricing';

type Status={ok?:boolean;configured?:boolean;verified?:boolean;sellerIdentityConfirmed?:boolean;reason?:string;error?:string;sandboxSetup?:{testBuyerConfigured:boolean;sandboxCredentialsConfirmed:boolean;sandboxCheckoutEnabled:boolean;paymentsOperational:boolean}};
const descriptions:Record<string,string>={
 authenticated_test_seller_identity_matched:'La credencial está autenticada y corresponde al ID del vendedor de prueba indicado en Mercado Pago Developers. Esto no habilita pagos ni confirma pruebas de renovación.',
 authenticated_seller_identity_unconfirmed:'Mercado Pago autenticó la credencial, pero el identificador no coincide con el vendedor de prueba esperado. Mantén bloqueadas las suscripciones.',
 authenticated:'Mercado Pago aceptó la credencial para una consulta de lectura. El entorno de pruebas aún debe confirmarse antes de habilitar cualquier cobro.',
 authenticated_environment_unverified:'Mercado Pago aceptó la credencial para una consulta de lectura. Esto no confirma que sea de prueba: las credenciales APP_USR pueden ser de prueba o de producción. Los cobros seguirán bloqueados.',
 missing_token:'No hay credencial de Mercado Pago configurada en la API de staging.',
 unrecognized_token_format:'La credencial tiene un formato no reconocido. Confirma que provenga de Credenciales de prueba de MW1 CRM.',
 invalid_token:'Mercado Pago rechazó la credencial de prueba. Revísala en Developers.',
 provider_error:'Mercado Pago no pudo validar la credencial. Revisa la integración.',
 network_error:'No fue posible conectarse a Mercado Pago desde staging.',
};
export default function MercadoPagoAdminPage(){
 const [status,setStatus]=useState<Status|null>(null);
 const [busy,setBusy]=useState(false);
 const [eventRows,setEventRows]=useState<Array<{id:string;provider_event_type:string;reconciliation_status:string;received_at:string}>>([]);
 const [eventError,setEventError]=useState('');
 const [checkingEvent,setCheckingEvent]=useState<string|null>(null);
 const [eventResult,setEventResult]=useState('');
 async function loadEvents(){
  setEventError('');
  try{const response=await fetch('/api/platform-admin/mercadopago-events',{cache:'no-store'});
   const data=await response.json();
   if(!response.ok||!data.ok){setEventError(data.error||'No fue posible consultar eventos.');return;}
   setEventRows(Array.isArray(data.events)?data.events:[]);
  }catch{setEventError('No se pudo consultar la cola de eventos.');}
 }
 async function checkEvent(id:string){
  setCheckingEvent(id);setEventResult('');
  try{const response=await fetch('/api/platform-admin/mercadopago-events?event='+encodeURIComponent(id),{cache:'no-store'});
   const result=await response.json();
   setEventResult(result.ok?(result.paymentConfirmed?'Pago acreditado comprobado con Mercado Pago. Aún no se ha registrado ni activado el plan.':'Evento comprobado con Mercado Pago; pago todavía no confirmado.'):'No se pudo conciliar: '+(result.reason||result.error||'pendiente'));
  }catch{setEventResult('Falló la verificación con Mercado Pago.');}
  finally{setCheckingEvent(null);}
 }

 const [published,setPublished]=useState<Array<{plan_key:string;price_cop:number}>>([]);
 useEffect(()=>{let live=true;void fetch('/api/platform-admin/plan-published',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(data=>{if(live&&Array.isArray(data?.plans))setPublished(data.plans.filter((p:unknown)=>Boolean(p)&&typeof p==='object'&&Number.isSafeInteger((p as {price_cop?:number}).price_cop)));}).catch(()=>{});return()=>{live=false};},[]);
 async function verify(){
  setBusy(true);setStatus(null);
  try{
   const response=await fetch('/api/platform-admin/mercadopago-verify',{cache:'no-store'});
   const body=await response.json() as Status;
   setStatus(response.ok?body:{ok:false,error:body.error||'No se pudo verificar. Inicia sesión como superadministrador.'});
  }catch{setStatus({ok:false,error:'No fue posible comprobar el servicio.'});}
  finally{setBusy(false);}
 }
 return <main style={{maxWidth:860,margin:'0 auto',padding:'30px 22px',color:'#172235'}}>
  <p style={{fontSize:12,fontWeight:800,color:'#8e6b0c'}}>CONFIGURACIÓN / PASARELA DE PAGOS</p>
  <h1 style={{fontSize:30,margin:'10px 0'}}>Mercado Pago</h1>
  <p style={{color:'#586477',lineHeight:1.7}}>Comprueba la credencial desde el superadministrador, sin mostrar claves ni generar cobros. El estado de la conexión no autoriza pagos.</p>
  <section style={{border:'1px solid #e1e5ec',borderRadius:14,background:'#fff',padding:25,marginTop:24}}>
   <h2 style={{fontSize:19}}>Conexión de staging</h2>
   <p style={{color:'#586477',fontSize:14}}>Proveedor: Mercado Pago · Suscripciones · Entorno de pruebas</p>
   <button type="button" disabled={busy} onClick={()=>void verify()} style={{padding:'12px 18px',border:0,borderRadius:9,background:'#f4bf00',color:'#172235',fontWeight:800,cursor:'pointer',marginTop:12}}>
    {busy?'Verificando…':'Verificar conexión'}
   </button>
   {status&&<div role="status" style={{marginTop:17,padding:14,borderRadius:9,background:'#f6f7fa',fontSize:14,lineHeight:1.6}}>
    <strong>{status.sellerIdentityConfirmed?'Vendedor de prueba identificado':status.verified?'Conexión autenticada · identidad sin confirmar':status.error?'No se pudo completar la consulta':'Integración pendiente de validación'}</strong>
    <p style={{margin:'7px 0 0'}}>{status.error||descriptions[status.reason||'']||(status.verified?'La autenticación fue aceptada. Aún no hay cobros habilitados.':'No se pudo confirmar la credencial.')}</p>
   </div>}
  </section>
  {status?.sandboxSetup&&<section style={{border:'1px solid #e1e5ec',borderRadius:14,background:'#fff',padding:25,marginTop:18}}>
   <h2 style={{fontSize:19}}>Preparación de pagos de prueba</h2>
   <p style={{fontSize:13,color:'#586477',lineHeight:1.6}}>Estado de configuración en Railway staging. Una credencial autenticada no confirma que sea de prueba.</p>
   {[
    ['Comprador de prueba configurado',status.sandboxSetup.testBuyerConfigured],
    ['Credenciales de pruebas confirmadas',status.sandboxSetup.sandboxCredentialsConfirmed],
    ['Checkout de prueba habilitado',status.sandboxSetup.sandboxCheckoutEnabled],
    ['Pagos operativos',status.sandboxSetup.paymentsOperational],
   ].map(([name,ready])=><p key={String(name)} style={{fontSize:14,margin:'9px 0'}}><strong>{ready?'Configurado':'Pendiente'}</strong> · {name}</p>)}
   <p style={{fontSize:13,color:'#765c19'}}>Estos controles no autorizan cobros reales ni sustituyen la verificación de los pagos y webhooks.</p>
  </section>}
  <section style={{border:'1px solid #e1e5ec',borderRadius:14,background:'#fff',padding:25,marginTop:18}}>
   <h2 style={{fontSize:19}}>Notificaciones recibidas</h2>
   <p style={{fontSize:13,color:'#586477'}}>Consulta y contrasta suscripciones sin generar cargos ni activar planes.</p>
   <button type="button" onClick={()=>void loadEvents()} style={{padding:'10px 15px',borderRadius:8,border:'1px solid #d8dde7',background:'#fff',fontWeight:750}}>Consultar notificaciones</button>
   {eventError&&<p role="alert">{eventError}</p>}
   {eventRows.length===0&&!eventError&&<p style={{fontSize:13,color:'#657184'}}>Pulsa consultar para ver las notificaciones disponibles.</p>}
   {eventRows.map(item=><div key={item.id} style={{borderTop:'1px solid #e8ebf0',padding:'12px 0',fontSize:13}}>
    <strong>{item.provider_event_type}</strong> · {item.reconciliation_status}
    <p style={{color:'#657184',margin:'4px 0'}}>{new Date(item.received_at).toLocaleString('es-CO')}</p>
    {['subscription_preapproval','subscription_authorized_payment'].includes(item.provider_event_type)&&<button type="button" disabled={checkingEvent!==null} onClick={()=>void checkEvent(item.id)} style={{border:'1px solid #d8dde7',borderRadius:7,padding:'7px 12px',background:'#fff'}}>{checkingEvent===item.id?'Comprobando…':'Verificar con Mercado Pago'}</button>}
   </div>)}
   {eventResult&&<p role="status" style={{fontSize:13,color:'#475569'}}>{eventResult}</p>}
  </section>
  <section style={{border:'1px solid #e1e5ec',borderRadius:14,background:'#fff',padding:25,marginTop:18}}>
   <h2 style={{fontSize:19}}>Facturación y renovaciones</h2>
   <p style={{fontSize:14,lineHeight:1.7,color:'#586477'}}>Los cobros, autorizaciones de tarjeta, suscripciones automáticas y la promoción del segundo mes al 50 % aún no están habilitados. Antes deben verificarse los precios publicados, webhooks y pruebas de cobros recurrentes.</p>
   <div style={{margin:'15px 0',padding:15,background:'#f6f7fa',borderRadius:10}}>
    <strong style={{fontSize:14}}>Simulación de promoción (sin cobros)</strong>
    {published.length===0?<p style={{fontSize:13,color:'#725b1f'}}>Aún no hay tarifas comerciales publicadas. Revisa «Planes y precios» y publícalas únicamente después de su aprobación.</p>:
     published.map(plan=>{const months=calculateIntroductoryMonths(plan.price_cop);return <div key={plan.plan_key} style={{borderTop:'1px solid #e2e6ec',padding:'12px 0',fontSize:13}}>
      <strong>{({'inicial':'Básico','pro':'Eco','empresa':'Pro'} as Record<string,string>)[plan.plan_key]||plan.plan_key}</strong>
      <p style={{margin:'5px 0'}}>Mes 1: {months[0].toLocaleString('es-CO')} COP · Mes 2: {months[1].toLocaleString('es-CO')} COP · Mes 3 en adelante: {months[2].toLocaleString('es-CO')} COP</p>
     </div>})
    }
   </div>
   <p style={{fontSize:13,color:'#7a601e'}}>No pegues el Access Token ni datos de tarjetas en esta pantalla.</p>
  </section>
 </main>;
}
