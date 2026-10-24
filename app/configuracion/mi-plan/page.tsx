'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {AppSidebar} from '../../components/AppSidebar';
type Plan={plan_key:string;max_users:number;max_whatsapp_lines:number;ai_enabled:boolean;whatsapp_enabled:boolean;instagram_enabled:boolean;messenger_enabled:boolean;automations_enabled:boolean;statistics_enabled:boolean};
type Data={ok?:boolean;error?:string;company?:{name:string};plan?:Plan;activeUsers?:number;subscription?:{provider:string;billing_cycle:string;status:string;currency:string;amount_cop:number|null;next_billing_at:string|null;current_period_end:string|null;cancel_at_period_end:boolean}|null;transactions?:Array<{id:string;amount_cop:number;currency:string;status:string;paid_at:string|null;created_at:string}>;availablePlans?:Array<{plan_key:string;price_cop:number;max_users:number}>;requests?:Array<{id:string;request_type:string;requested_plan_key:string|null;status:string;created_at:string}>};
export default function MiPlan(){
 const [data,setData]=useState<Data|null>(null);
 const [targetPlan,setTargetPlan]=useState('');
 const [extraSeats,setExtraSeats]=useState(1);
 const [notice,setNotice]=useState('');
 const [working,setWorking]=useState(false);
 async function submitRequest(type:'change_plan'|'cancel_renewal'|'extra_users'){
  if(working)return;
  if(type==='cancel_renewal'&&!window.confirm('¿Registrar una solicitud de cancelación de renovación? No cancela el servicio inmediatamente.'))return;
  setWorking(true);setNotice('');
  try{
   const r=await fetch('/api/mi-plan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type,planKey:type==='change_plan'?targetPlan:undefined,additionalUsers:type==='extra_users'?extraSeats:undefined})});
   const result=await r.json();
   setNotice(result.message||result.error||'No se pudo registrar la solicitud.');
   if(r.ok){const updated=await fetch('/api/mi-plan',{cache:'no-store'}).then(x=>x.json());setData(updated)}
  }catch{setNotice('No fue posible registrar la solicitud.')}finally{setWorking(false)}
 }

 useEffect(()=>{let active=true;fetch('/api/mi-plan',{cache:'no-store'}).then(r=>r.json()).then(d=>{if(active)setData(d)}).catch(()=>{if(active)setData({error:'No se pudo consultar el plan.'})});return()=>{active=false}},[]);
 return <main style={{display:'flex',minHeight:'100vh',background:'#f6f7f9',color:'#172235'}}>
  <AppSidebar companyName={data?.company?.name||'Empresa'}/>
  <section style={{flex:1,padding:'36px 42px',maxWidth:1080}}>
   <p style={{color:'#977313',fontWeight:800,fontSize:12}}>CONFIGURACIÓN / MI PLAN</p>
   <h1 style={{fontSize:30,margin:'12px 0'}}>Mi plan y facturación</h1>
   <p style={{color:'#657184',marginBottom:24}}>Consulta los límites registrados de tu empresa. La facturación electrónica y la gestión de suscripciones todavía no están integradas en el piloto.</p>
   {!data?<p>Cargando información del plan…</p>:!data.ok?<p role="alert" style={{color:'#a82e35'}}>{data.error||'No se pudo cargar.'}</p>:
   <div style={{display:'grid',gap:18}}>
    <article style={{background:'white',padding:25,borderRadius:15,border:'1px solid #e7e1d1'}}>
      <strong style={{color:'#886b11'}}>PLAN REGISTRADO</strong>
      <h2 style={{fontSize:28,margin:'12px 0'}}>{data.plan?.plan_key?.toUpperCase()}</h2>
      <p>Usuarios activos: {data.activeUsers} de {data.plan?.max_users}</p>
      <p>Líneas de WhatsApp permitidas: {data.plan?.max_whatsapp_lines}</p>
      <p style={{marginTop:15}}>Módulos autorizados: {[
       data.plan?.ai_enabled&&'IA',data.plan?.whatsapp_enabled&&'WhatsApp',
       data.plan?.instagram_enabled&&'Instagram',data.plan?.messenger_enabled&&'Messenger',
       data.plan?.automations_enabled&&'Automatizaciones',data.plan?.statistics_enabled&&'Estadísticas'
      ].filter(Boolean).join(', ')||'Sin módulos adicionales'}.</p>
    </article>
    <article style={{background:'white',padding:25,borderRadius:15,border:'1px solid #e7e1d1'}}>
     <h2>Renovación automática</h2>
     {!data.subscription ? <p style={{marginTop:10}}>La renovación automática aún no está configurada para esta empresa. El registro seguro de tarjetas se habilitará con la pasarela de pagos, sin almacenar tarjetas en MW1.</p> : <>
      <p>Proveedor: {data.subscription.provider==='mercadopago'?'Mercado Pago':'Wompi'}</p>
      <p>Estado: {({awaiting_authorization:'Pendiente de autorización',pending:'Pendiente',active:'Activa',past_due:'Pago vencido',grace_period:'Período de gracia',paused:'Pausada',cancelled:'Cancelada',expired:'Vencida'} as Record<string,string>)[data.subscription.status]||'Por verificar'}</p>
      <p>Periodicidad: {data.subscription.billing_cycle==='monthly'?'Mensual':'Anual'}</p>
      <p>Próxima renovación: {data.subscription.next_billing_at?new Date(data.subscription.next_billing_at).toLocaleDateString('es-CO'):'No programada'}</p>
      <p>Cancelación al finalizar el período: {data.subscription.cancel_at_period_end?'Solicitada':'No registrada'}</p>
     </>}
    </article>
    <article style={{background:'white',padding:25,borderRadius:15,border:'1px solid #e7e1d1'}}>
     <h2>Pagos y suscripción</h2>
     <p style={{marginTop:10}}>Aún no hay una pasarela de suscripciones ni historial de pagos verificado conectado a este piloto. No se puede confirmar aquí si el plan está pagado.</p>
     <p style={{marginTop:10}}>Los cambios de plan, las cancelaciones y las facturas estarán disponibles cuando esté implementado el sistema de facturación.</p>
    </article>
    <article style={{background:'white',padding:25,borderRadius:15,border:'1px solid #e7e1d1'}}>
     <h2>Solicitar un cambio de plan</h2>
     <p style={{margin:'10px 0 14px'}}>La solicitud queda pendiente de revisión. No modifica el plan ni genera cobros automáticamente.</p>
     <label htmlFor="plan-target" style={{display:'block',marginBottom:8}}>Plan publicado</label>
     <select id="plan-target" value={targetPlan} onChange={e=>setTargetPlan(e.target.value)} style={{padding:10,marginRight:12,borderRadius:8}}>
      <option value="">Seleccionar plan</option>
      {(data.availablePlans??[]).filter(x=>x.plan_key!==data.plan?.plan_key).map(x=><option value={x.plan_key} key={x.plan_key}>{x.plan_key.toUpperCase()} — {x.price_cop.toLocaleString('es-CO',{style:'currency',currency:'COP'})}</option>)}
     </select>
     <button disabled={!targetPlan||working} onClick={()=>void submitRequest('change_plan')} style={{padding:11,border:0,borderRadius:8,background:'#f4bf00',fontWeight:800}}>Solicitar cambio</button>
     <h3 style={{marginTop:24}}>Solicitar usuarios adicionales</h3>
     <p>Solicita cupos adicionales sin cambiar de plan. El precio queda pendiente de cotización; no se genera ningún cobro automáticamente.</p>
     <input aria-label="Cantidad de usuarios adicionales" type="number" min={1} max={100} value={extraSeats} onChange={e=>setExtraSeats(Number(e.target.value))} />
     <button type="button" disabled={working||extraSeats<1||extraSeats>100||!Number.isInteger(extraSeats)} onClick={()=>void submitRequest('extra_users')}>Solicitar usuarios</button>
     <h3 style={{marginTop:24}}>Cancelación de renovación</h3>
     <p style={{margin:'8px 0'}}>Puedes solicitar revisión de cancelación. No se interrumpe el servicio al enviar esta solicitud.</p>
     <button disabled={working} onClick={()=>void submitRequest('cancel_renewal')} style={{padding:11,border:'1px solid #c9cdd3',borderRadius:8,background:'#fff'}}>Solicitar cancelación</button>
     {notice&&<p role="status" style={{marginTop:14}}>{notice}</p>}
    </article>
    <article style={{background:'white',padding:25,borderRadius:15,border:'1px solid #e7e1d1'}}>
     <h2>Mis solicitudes</h2>
     {(data.requests??[]).length===0?<p style={{marginTop:10}}>No hay solicitudes registradas.</p>:(data.requests??[]).map(x=><p key={x.id} style={{padding:'12px 0',borderBottom:'1px solid #eee'}}>{x.request_type==='change_plan'?'Cambio a '+x.requested_plan_key:x.request_type==='extra_users'?'Solicitud de usuarios adicionales':'Cancelar renovación'} — {x.status==='pending'?'Pendiente de revisión':x.status}</p>)}
    </article>
   </div>}
   <p style={{marginTop:25}}><Link href="/configuracion" style={{color:'#755a00'}}>← Volver a configuración</Link></p>
  </section>
 </main>;
}
