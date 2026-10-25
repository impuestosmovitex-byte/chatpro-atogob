'use client';
import {useEffect,useState} from 'react';
import {calculateIntroductoryMonths} from '../../lib/mw1-subscription-pricing';

type Status={ok?:boolean;configured?:boolean;verified?:boolean;reason?:string;error?:string};
const descriptions:Record<string,string>={
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
    <strong>{status.verified?'Conexión autenticada':status.error?'No se pudo completar la consulta':'Integración pendiente de validación'}</strong>
    <p style={{margin:'7px 0 0'}}>{status.error||descriptions[status.reason||'']||(status.verified?'La autenticación fue aceptada. Aún no hay cobros habilitados.':'No se pudo confirmar la credencial.')}</p>
   </div>}
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
