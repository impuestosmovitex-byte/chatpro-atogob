'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {AppSidebar} from '../../components/AppSidebar';
import {MW1_COMMERCIAL_PROPOSAL} from '../../lib/mw1-commercial-proposal';
const commercialName=(key:string)=>MW1_COMMERCIAL_PROPOSAL.find(p=>p.legacyKey===key)?.name||key.toUpperCase();
const cop=(value:number)=>value.toLocaleString('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0});
type Plan={plan_key:string;max_users:number;max_whatsapp_lines:number;ai_enabled:boolean;whatsapp_enabled:boolean;instagram_enabled:boolean;messenger_enabled:boolean;automations_enabled:boolean;statistics_enabled:boolean};
type Data={ok?:boolean;error?:string;company?:{name:string};plan?:Plan;activeUsers?:number;subscription?:{provider:string;billing_cycle:string;status:string;currency:string;amount_cop:number|null;next_billing_at:string|null;current_period_end:string|null;cancel_at_period_end:boolean}|null;transactions?:Array<{id:string;amount_cop:number;currency:string;status:string;paid_at:string|null;created_at:string}>;availablePlans?:Array<{plan_key:string;price_cop:number;max_users:number;max_whatsapp_lines:number;extra_user_cop:number|null;public_summary:string|null;public_features:string[]|null}>;requests?:Array<{id:string;request_type:string;requested_plan_key:string|null;status:string;created_at:string}>};
export default function MiPlan(){
 const [data,setData]=useState<Data|null>(null);
 const [targetPlan,setTargetPlan]=useState('');
 const [expandedPlans,setExpandedPlans]=useState<string[]>([]);
 const togglePlan=(key:string)=>setExpandedPlans(old=>old.includes(key)?old.filter(x=>x!==key):[...old,key]);
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
  <section style={{flex:1,padding:'clamp(18px,3vw,42px)',width:'100%',maxWidth:1280,minWidth:0}}>
   <p style={{color:'#977313',fontWeight:800,fontSize:12}}>CONFIGURACIÓN / MI PLAN</p>
   <h1 style={{fontSize:30,margin:'12px 0'}}>Mi plan y facturación</h1>
   <p style={{color:'#657184',marginBottom:24}}>Consulta tu plan actual, administra tu suscripción y revisa tus pagos.</p>
   {!data?<p>Cargando información del plan…</p>:!data.ok?<p role="alert" style={{color:'#a82e35'}}>{data.error||'No se pudo cargar.'}</p>:
   <div style={{display:'grid',gap:20,maxWidth:1060}}>
    <article style={{background:'white',padding:25,borderRadius:15,border:'1px solid #e7e1d1'}}>
      <strong style={{color:'#886b11'}}>MI PLAN</strong>
      <h2 style={{fontSize:28,margin:'12px 0'}}>{commercialName(data.plan?.plan_key??'')}</h2>

      <p>Usuarios activos: {data.activeUsers} de {data.plan?.max_users}</p>
      <p>Líneas de WhatsApp permitidas: {data.plan?.max_whatsapp_lines}</p>
      <p style={{marginTop:15,fontWeight:700}}>Características habilitadas para tu empresa</p>
      <ul style={{paddingLeft:19,margin:'8px 0',lineHeight:1.7}}>
       {[data.plan?.whatsapp_enabled&&'WhatsApp',data.plan?.instagram_enabled&&'Instagram',
         data.plan?.messenger_enabled&&'Messenger',data.plan?.ai_enabled&&'Inteligencia artificial',
         data.plan?.automations_enabled&&'Automatizaciones',data.plan?.statistics_enabled&&'Estadísticas']
        .filter((x):x is string=>Boolean(x)).map(x=><li key={x}>{x}</li>)}
      </ul>
      <p style={{fontSize:12,color:'#657184'}}>Estos módulos corresponden a los permisos registrados. Su uso requiere las conexiones y configuraciones correspondientes.</p>
      <p style={{display:'none'}}>Módulos autorizados: {[
       data.plan?.ai_enabled&&'IA',data.plan?.whatsapp_enabled&&'WhatsApp',
       data.plan?.instagram_enabled&&'Instagram',data.plan?.messenger_enabled&&'Messenger',
       data.plan?.automations_enabled&&'Automatizaciones',data.plan?.statistics_enabled&&'Estadísticas'
      ].filter(Boolean).join(', ')||'Sin módulos adicionales'}.</p>
    </article>
    <article style={{background:'white',padding:25,borderRadius:15,border:'1px solid #e7e1d1'}}>
     <h2>Gestionar mi plan</h2>
     <p style={{margin:'10px 0 14px'}}>La solicitud queda pendiente de revisión. No modifica el plan ni genera cobros automáticamente.</p>
     <label htmlFor="plan-target" style={{display:'block',marginBottom:8,fontWeight:700}}>Selecciona otro plan</label>
     <select id="plan-target" value={targetPlan} onChange={e=>setTargetPlan(e.target.value)} style={{padding:'12px 14px',marginRight:12,borderRadius:9,border:'1px solid #c9cfd8',minWidth:210,maxWidth:'100%'}}>
      <option value="">Seleccionar plan</option>
      {(data.availablePlans??[]).filter(x=>x.plan_key!==data.plan?.plan_key).map(x=><option value={x.plan_key} key={x.plan_key}>{commercialName(x.plan_key)} — {cop(x.price_cop)}</option>)}
     </select>
     <button disabled={!targetPlan||working} onClick={()=>void submitRequest('change_plan')} style={{padding:11,border:0,borderRadius:8,background:'#f4bf00',fontWeight:800}}>Solicitar cambio</button>
     {(data.availablePlans??[]).length===0&&<p style={{fontSize:13,color:'#8a6d12',marginTop:10}}>Los precios de los planes todavía no están publicados por MW1. El superadministrador debe revisarlos y publicarlos antes de recibir solicitudes de cambio.</p>}
     <hr style={{margin:'25px 0',border:0,borderTop:'1px solid #ebedf0'}}/>
     <h3 style={{marginTop:24}}>Solicitar usuarios adicionales</h3>
     <p>Solicita cupos adicionales sin cambiar de plan. No se genera ningún cobro automáticamente.</p>
     {(()=>{const price=data.availablePlans?.find(x=>x.plan_key===data.plan?.plan_key)?.extra_user_cop;return <p style={{fontSize:13,color:'#657184',margin:'8px 0'}}>{typeof price==='number'&&price>0?`Tarifa publicada por usuario adicional: ${cop(price)}. Referencia para ${extraSeats} cupo(s): ${cop(price*extraSeats)} por período, antes de confirmar condiciones comerciales.`:'Tarifa por usuario adicional pendiente de publicación y cotización.'}</p>})()}
     <div style={{display:'flex',flexWrap:'wrap',gap:12,alignItems:'center',marginTop:12}}>
     <label htmlFor="additional-seats" style={{fontWeight:700}}>Cantidad</label>
     <input id="additional-seats" aria-label="Cantidad de usuarios adicionales" type="number" min={1} max={100} value={extraSeats} onChange={e=>setExtraSeats(Number(e.target.value))} style={{width:86,padding:'12px',borderRadius:9,border:'1px solid #c9cfd8',fontSize:15}} />
     <button type="button" disabled={working||extraSeats<1||extraSeats>100||!Number.isInteger(extraSeats)} onClick={()=>void submitRequest('extra_users')} style={{padding:'12px 18px',border:0,borderRadius:9,background:'#f4bf00',color:'#172235',fontWeight:800,cursor:'pointer'}}>Solicitar usuarios</button>
     </div>
     <hr style={{margin:'25px 0',border:0,borderTop:'1px solid #ebedf0'}}/>
     <h3 style={{marginTop:24}}>Cancelación de renovación</h3>
     <p style={{margin:'8px 0'}}>Puedes solicitar revisión de cancelación. No se interrumpe el servicio al enviar esta solicitud.</p>
     <button disabled={working} onClick={()=>void submitRequest('cancel_renewal')} style={{padding:11,border:'1px solid #c9cdd3',borderRadius:8,background:'#fff'}}>Solicitar cancelación</button>
     {notice&&<p role="status" style={{marginTop:14}}>{notice}</p>}
    </article>
    <article style={{background:'white',padding:25,borderRadius:15,border:'1px solid #e7e1d1'}}>
      <p style={{fontSize:12,color:'#977313',fontWeight:800}}>MÉTODO DE PAGO</p>
      <h2 style={{fontSize:23,margin:'8px 0'}}>Tarjeta y renovación automática</h2>
      {!data.subscription ? <>
       <p style={{margin:'12px 0'}}>Aún no tienes un método de pago vinculado a una suscripción de MW1.</p>
       <p style={{color:'#657184',lineHeight:1.6}}>Cuando activemos Mercado Pago podrás autorizar tu tarjeta en su sitio seguro. MW1 no almacenará el número completo ni el CVV.</p>
       <button type="button" disabled style={{marginTop:14,padding:'12px 18px',border:0,borderRadius:9,background:'#f4bf00',color:'#67561e',fontWeight:800,cursor:'not-allowed'}}>Registrar tarjeta · Próximamente</button>
      </> : <>
       <p style={{marginTop:12}}>Proveedor: {data.subscription.provider==='mercadopago'?'Mercado Pago':'Wompi'}</p>
       <p>Estado de suscripción: {({awaiting_authorization:'Pendiente de autorización',pending:'Pendiente',active:'Activa',past_due:'Pago vencido',grace_period:'Período de gracia',paused:'Pausada',cancelled:'Cancelada',expired:'Vencida'} as Record<string,string>)[data.subscription.status]||'Por verificar'}</p>
       <p>Renovación: {data.subscription.billing_cycle==='monthly'?'Mensual':'Anual'}</p>
       <p>Próximo cobro: {data.subscription.next_billing_at?new Date(data.subscription.next_billing_at).toLocaleDateString('es-CO'):'Sin fecha confirmada'}</p>
       <p>Cancelación al finalizar el período: {data.subscription.cancel_at_period_end?'Registrada':'No registrada'}</p>
      </>}
      <p style={{marginTop:17,padding:'12px 14px',background:'#fff8e3',borderRadius:9,fontSize:13,color:'#755600'}}><strong>Estado de integración:</strong> Mercado Pago en preparación. Antes de aceptar tarjetas se deben publicar las tarifas, configurar credenciales de prueba, verificar las notificaciones y superar las pruebas de renovación. No compartas datos bancarios en este sistema.</p>
      <p style={{marginTop:17,fontSize:13,color:'#657184'}}>La renovación automática todavía no está operativa en este piloto. Nunca ingreses datos bancarios en el chat o soporte.</p>
    </article>
    <article style={{background:'white',padding:25,borderRadius:15,border:'1px solid #e7e1d1'}}>
      <h2>Historial de pagos</h2>
      {(data.transactions??[]).length===0?<p style={{marginTop:10,color:'#657184'}}>Todavía no hay pagos de suscripción verificados.</p>:(data.transactions??[]).map(t=><p key={t.id} style={{padding:'10px 0',borderBottom:'1px solid #eee'}}>{t.amount_cop.toLocaleString('es-CO',{style:'currency',currency:'COP'})} · {({approved:'Aprobado',pending:'Pendiente',rejected:'Rechazado',refunded:'Reembolsado',chargeback:'Contracargo'} as Record<string,string>)[t.status]||'Por verificar'}</p>)}
      <p style={{marginTop:12,color:'#657184',fontSize:13}}>Las facturas y cobros automáticos se habilitarán cuando la pasarela esté verificada.</p>
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
