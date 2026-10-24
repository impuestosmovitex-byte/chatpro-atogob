'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {AppSidebar} from '../../components/AppSidebar';
type Plan={plan_key:string;max_users:number;max_whatsapp_lines:number;ai_enabled:boolean;whatsapp_enabled:boolean;instagram_enabled:boolean;messenger_enabled:boolean;automations_enabled:boolean;statistics_enabled:boolean};
type Data={ok?:boolean;error?:string;company?:{name:string};plan?:Plan;activeUsers?:number};
export default function MiPlan(){
 const [data,setData]=useState<Data|null>(null);
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
     <h2>Pagos y suscripción</h2>
     <p style={{marginTop:10}}>Aún no hay una pasarela de suscripciones ni historial de pagos verificado conectado a este piloto. No se puede confirmar aquí si el plan está pagado.</p>
     <p style={{marginTop:10}}>Los cambios de plan, las cancelaciones y las facturas estarán disponibles cuando esté implementado el sistema de facturación.</p>
    </article>
   </div>}
   <p style={{marginTop:25}}><Link href="/configuracion" style={{color:'#755a00'}}>← Volver a configuración</Link></p>
  </section>
 </main>;
}
