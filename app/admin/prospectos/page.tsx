'use client';
import {useCallback,useEffect,useMemo,useState} from 'react';
import Link from 'next/link';
import {PlatformSidebar} from '../../components/PlatformSidebar';
import styles from './prospectos.module.css';

type Lead={
 id:string;companyName:string;contactName:string;contactEmail:string;
 contactPhone:string|null;planInterest:string;status:string;source?:string;
 requestType:'trial'|'demo';createdAt:string;followUpOn:string|null;
 internalNote:string;requestedUsers:number|null;requestedConnections:number|null;
};
type Response={ok?:boolean;error?:string;requests?:Lead[]};
const statuses:Record<string,string>={new:'Nuevo',contacted:'Contactado',qualified:'Calificado',closed:'Cerrado'};
const plans:Record<string,string>={inicial:'Básico',pro:'Eco',empresa:'Pro',sin_definir:'Por definir'};
const fields=(note:string)=>({
 sector:note.match(/(?:^| \| )Sector: ([^|]+)/)?.[1]?.trim()||'Por confirmar',
 web:note.match(/(?:^| \| )Presencia web: ([^|]+)/)?.[1]?.trim()||'Por confirmar',
});
function localDay(iso:string){return new Date(iso).toLocaleDateString('es-CO',{year:'numeric',month:'short',day:'numeric',timeZone:'America/Bogota'});}
function bogotaToday(){
 const parts=new Intl.DateTimeFormat('en-US',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'America/Bogota'}).formatToParts(new Date());
 const part=(type:string)=>parts.find(x=>x.type===type)?.value||'';
 return `${part('year')}-${part('month')}-${part('day')}`;
}

export default function ProspectosPage(){
 const [rows,setRows]=useState<Lead[]>([]);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [query,setQuery]=useState('');
 const [status,setStatus]=useState('all');
 const [reload,setReload]=useState(0);
 const load=useCallback(async(signal:AbortSignal)=>{
   setLoading(true);setError('');
   try{
     const res=await fetch('/api/platform-admin/demo-requests',{cache:'no-store',signal});
     const data=await res.json() as Response;
     if(!res.ok||!data.ok)throw new Error(data.error||'No se pudieron consultar los prospectos.');
     if(!signal.aborted)setRows(Array.isArray(data.requests)?data.requests:[]);
   }catch(cause){if(!signal.aborted){setRows([]);setError(cause instanceof Error?cause.message:'No se pudo cargar.');}}
   finally{if(!signal.aborted)setLoading(false);}
 },[]);
 useEffect(()=>{const controller=new AbortController();void load(controller.signal);return()=>controller.abort();},[load,reload]);
 const today=bogotaToday();
 const visible=useMemo(()=>rows.filter(lead=>{
   if(status!=='all'&&lead.status!==status)return false;
   const term=query.trim().toLocaleLowerCase('es-CO');
   return !term||[lead.companyName,lead.contactName,lead.contactEmail,lead.contactPhone||''].some(x=>x.toLocaleLowerCase('es-CO').includes(term));
 }),[rows,query,status]);
 const upcoming=rows.filter(x=>x.followUpOn&&x.followUpOn>=today&&x.status!=='closed').length;
 const overdue=rows.filter(x=>x.followUpOn&&x.followUpOn<today&&x.status!=='closed').length;
 return <div className={styles.site}>
  <PlatformSidebar/>
  <main className={styles.main}>
   <div className={styles.topline}>MW1 / ADMINISTRACIÓN COMERCIAL</div>
   <div className={styles.header}>
    <div><h1>Prospectos y demostraciones</h1>
     <p>Consulta las solicitudes comerciales recibidas y sus próximos seguimientos. Solo Super Admin. No crea empresas, no agenda reuniones y no envía mensajes.</p>
    </div>
    <button type="button" onClick={()=>setReload(v=>v+1)} disabled={loading}>{loading?'Actualizando…':'Actualizar solicitudes'}</button>
   </div>
   {error?<div role="alert" className={styles.error}>{error} <Link href="/login?mode=platform&next=%2Fadmin%2Fprospectos">Iniciar sesión como Super Admin</Link></div>:<>
    <div className={styles.metrics} aria-label="Resumen de las últimas solicitudes">
     <article><small>Solicitudes cargadas</small><strong>{rows.length}</strong></article>
     <article><small>Nuevas</small><strong>{rows.filter(x=>x.status==='new').length}</strong></article>
     <article><small>Seguimientos pendientes hoy o vencidos</small><strong>{rows.filter(x=>x.followUpOn&&x.followUpOn<=today&&x.status!=='closed').length}</strong></article>
     <article><small>Próximos / Vencidos</small><strong>{upcoming} / {overdue}</strong></article>
    </div>
    <p className={styles.disclaimer}>Los indicadores se calculan únicamente sobre las últimas 50 solicitudes que devuelve la API existente. No representan necesariamente todo el historial.</p>
    <div className={styles.filters}>
      <label>Buscar por empresa, contacto, correo o WhatsApp
       <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar prospecto" maxLength={120}/></label>
      <label>Estado
       <select value={status} onChange={e=>setStatus(e.target.value)}><option value="all">Todos</option>{Object.entries(statuses).map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label>
    </div>
    {loading?<p role="status">Cargando solicitudes…</p>:visible.length===0?<p role="status" className={styles.empty}>No hay solicitudes que coincidan con los filtros.</p>:
    <div className={styles.grid}>{visible.map(lead=>{
      const qualification=fields(lead.internalNote||'');
      return <article className={styles.card} key={lead.id}>
       <div className={styles.cardTop}><span className={styles.chip}>{statuses[lead.status]||'Por revisar'}</span><small>{localDay(lead.createdAt)}</small></div>
       <h2>{lead.companyName}</h2><p className={styles.person}>{lead.contactName}</p>
       <dl><div><dt>Correo</dt><dd>{lead.contactEmail}</dd></div>
        <div><dt>WhatsApp</dt><dd>{lead.contactPhone||'No registrado'}</dd></div>
        <div><dt>Sector</dt><dd>{qualification.sector}</dd></div>
        <div><dt>Presencia web</dt><dd>{qualification.web}</dd></div>
        <div><dt>Plan consultado</dt><dd>{plans[lead.planInterest]||'Por definir'}</dd></div>
        <div><dt>Próximo seguimiento</dt><dd>{lead.followUpOn||'Sin programar'}</dd></div></dl>
       <p className={styles.cardNote}>{lead.requestType==='trial'?'Solicitud de prueba guiada':'Solicitud de demostración'} · Sin reserva automática</p>
      </article>;
    })}</div>}
    <div className={styles.bottom}><p>Para modificar estado, fecha o notas, utiliza el módulo de empresas existente. Las notas internas pueden contener datos de consentimiento: no deben eliminarse al editar.</p>
      <Link href="/admin/empresas">Gestionar seguimiento en Empresas</Link>
    </div>
   </>}
  </main>
 </div>;
}
