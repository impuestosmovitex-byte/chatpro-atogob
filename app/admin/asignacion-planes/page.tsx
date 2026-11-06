'use client';
import {useEffect,useState} from 'react';
import {PlatformSidebar} from '../../components/PlatformSidebar';
type Company={id:string;name:string};
type Draft={company_id:string;tier:string;notes:string};
type AuditEvent={id:string;proposed_tier:string;action:string;actor_id:string;created_at:string};
export default function AssignmentDraftPage(){
 const [companies,setCompanies]=useState<Company[]>([]);
 const [drafts,setDrafts]=useState<Draft[]>([]);
 const [events,setEvents]=useState<AuditEvent[]>([]);
 const [reviewReason,setReviewReason]=useState('');
 const [companyId,setCompanyId]=useState('');
 const [tier,setTier]=useState('basico');
 const [notes,setNotes]=useState('');
 const [message,setMessage]=useState('');
 const [readiness,setReadiness]=useState<{commerciallyReady:boolean;reasons:string[]}|null>(null);
 const [busy,setBusy]=useState(false);
 const [loading,setLoading]=useState(true);
 useEffect(()=>{(async()=>{
  try{
   const me=await fetch('/api/platform-admin/me',{cache:'no-store'}).then(r=>r.json());
   if(me.platformAdmin!==true)throw new Error('Solo para superadministradores.');
   const [a,b]=await Promise.all([
    fetch('/api/platform-admin/companies',{cache:'no-store'}),
    fetch('/api/platform-admin/company-plan-assignment-drafts',{cache:'no-store'})]);
   const companiesData=await a.json(),draftData=await b.json();
   if(!a.ok||!b.ok||!companiesData.ok||!draftData.ok)throw new Error('No se pudo cargar la información.');
   setCompanies(companiesData.companies||[]);setDrafts(draftData.drafts||[]);
  }catch(e){setMessage(e instanceof Error?e.message:'Error de carga');}
  finally{setLoading(false);}
 })();},[]);
 async function submitReview(decision:'approve_review'|'reject'){
  if(!companyId||busy||reviewReason.trim().length<5)return;
  if(!window.confirm('¿Registrar esta decisión de revisión? No se activará el plan.'))return;
  setBusy(true);
  try{
   const res=await fetch('/api/platform-admin/company-plan-activation-review',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({companyId,decision,reason:reviewReason.trim()})});
   const data=await res.json();
   if(!res.ok||!data.ok)throw new Error(data.error||'No se pudo registrar.');
   const history=await fetch('/api/platform-admin/company-plan-activation-history?companyId='+encodeURIComponent(companyId),{cache:'no-store'});
   if(history.ok){const updated=await history.json();if(updated.ok)setEvents(updated.events||[]);}
   setReviewReason('');
   setMessage('Decisión auditada; no se modificó ningún permiso ni plan activo.');
  }catch(e){setMessage(e instanceof Error?e.message:'Error de revisión');}
  finally{setBusy(false);}
 }
 function selectCompany(id:string){
  setCompanyId(id);
  setEvents([]);
  if(id)void fetch('/api/platform-admin/company-plan-activation-history?companyId='+encodeURIComponent(id),{cache:'no-store'}).then(r=>r.json()).then(data=>{if(data.ok)setEvents(data.events||[]);}).catch(()=>{});
  setReadiness(null);
  if(id)void fetch('/api/platform-admin/company-plan-assignment-readiness?companyId='+encodeURIComponent(id),{cache:'no-store'}).then(r=>r.json()).then(data=>{if(data.ok)setReadiness(data);}).catch(()=>{});
  const draft=drafts.find(d=>d.company_id===id);
  setTier(draft?.tier||'basico');setNotes(draft?.notes||'');setMessage('');
 }
 async function save(){
  if(!companyId||busy)return;
  setBusy(true);setMessage('');
  try{
   const res=await fetch('/api/platform-admin/company-plan-assignment-drafts',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({companyId,tier,notes})});
   const data=await res.json();
   if(!res.ok||!data.ok)throw new Error(data.error||'No se pudo guardar.');
   setDrafts(prev=>[...prev.filter(d=>d.company_id!==companyId),data.draft]);
   setReadiness(null);
   const readyResponse=await fetch('/api/platform-admin/company-plan-assignment-readiness?companyId='+encodeURIComponent(companyId),{cache:'no-store'});
   if(readyResponse.ok)setReadiness(await readyResponse.json());
   setMessage('Asignación propuesta guardada. No se han cambiado permisos, cobros ni conexiones.');
  }catch(e){setMessage(e instanceof Error?e.message:'Error al guardar');}
  finally{setBusy(false);}
 }
 return <div style={{minHeight:'100vh',background:'#f5f7fb',color:'#142238'}}>
  <PlatformSidebar/>
  <main style={{marginLeft:196,padding:32,maxWidth:950}}>
   <h1>Asignación de planes por empresa</h1>
   <p>Preparación comercial en staging. Esta pantalla no activa planes ni cambia permisos operativos.</p>
   <section style={{background:'#fff',borderRadius:12,padding:24,display:'grid',gap:14}}>
    {loading?<p>Cargando empresas…</p>:<>
     <label>Empresa <select value={companyId} onChange={e=>selectCompany(e.target.value)}
      style={{display:'block',padding:10,width:'100%'}}>
      <option value="">Selecciona una empresa</option>
      {companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
     </select></label>
     <label>Plan propuesto <select value={tier} onChange={e=>setTier(e.target.value)}
      style={{display:'block',padding:10}}>
      <option value="basico">Básico</option><option value="eco">Eco</option><option value="pro">Pro</option>
     </select></label>
     <label>Notas internas <textarea value={notes} onChange={e=>setNotes(e.target.value)}
      maxLength={500} rows={3} style={{display:'block',width:'100%',padding:10}}/></label>
     <button type="button" disabled={!companyId||busy} onClick={()=>void save()}
      style={{padding:12,background:'#172235',color:'white',border:0,borderRadius:8}}>
      {busy?'Guardando…':'Guardar propuesta sin activar'}
     </button>
    </>}
    {readiness?.commerciallyReady&&companyId&&<button type="button" disabled={busy}
      onClick={async()=>{
       if(!window.confirm('¿Registrar solicitud de revisión para esta empresa? No activa el plan ni cambia permisos.'))return;
       setBusy(true);
       try{
        const response=await fetch('/api/platform-admin/company-plan-activation-request',{
         method:'POST',headers:{'content-type':'application/json'},
         body:JSON.stringify({companyId,confirm:'SOLICITAR REVISION DE ACTIVACION'})});
        const result=await response.json();
        if(!response.ok||!result.ok)throw new Error(result.error||'Error en solicitud');
        setMessage('Solicitud registrada para revisión. Plan todavía sin activar.');
       }catch(e){setMessage(e instanceof Error?e.message:'Error');}
       finally{setBusy(false);}
      }}
      style={{padding:12,border:'1px solid #172235',borderRadius:8,background:'white'}}>
      Solicitar revisión de activación (sin aplicar)
     </button>}
    {readiness&&<div style={{background:'#f1f5f9',padding:14,borderRadius:9}}><strong>{readiness.commerciallyReady?'Revisión comercial completa':'Requisitos pendientes'}</strong><p>La activación real permanece deshabilitada.</p>{readiness.reasons.map(reason=><p key={reason}>{reason}</p>)}</div>}
    {companyId&&events[0]?.action==='activation_requested'&&
     <div style={{display:'grid',gap:9}}>
      <strong>Revisar solicitud pendiente (sin activar plan)</strong>
      <textarea id="review-reason" placeholder="Justificación de la decisión (mínimo 5 caracteres)"
       maxLength={500} rows={2} onChange={e=>setReviewReason(e.target.value)}
       value={reviewReason} style={{padding:10}}/>
      <div style={{display:'flex',gap:10}}>
       {(['approve_review','reject'] as const).map(decision=>
        <button type="button" key={decision} disabled={busy||reviewReason.trim().length<5}
         onClick={()=>void submitReview(decision)}
         style={{padding:10,borderRadius:7,border:'1px solid #172235'}}>
         {decision==='reject'?'Rechazar solicitud':'Aprobar revisión (sin activar)'}
        </button>)}
      </div>
     </div>}
    {companyId&&<section><h2>Historial de solicitudes</h2>
     <p style={{fontSize:13,fontWeight:700}}>Estado de revisión: {events.length===0?'Sin solicitudes':events[0].action==='activation_rejected'?'Rechazada':events[0].action==='activation_requested'?'Pendiente de revisión':'Evento registrado'}</p>
     {events.length===0?<p>No hay solicitudes registradas para esta empresa.</p>:
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
       <thead><tr><th>Fecha</th><th>Plan</th><th>Evento</th><th>Administrador</th></tr></thead>
       <tbody>{events.map(event=><tr key={event.id}>
        <td>{new Date(event.created_at).toLocaleString('es-CO')}</td>
        <td>{event.proposed_tier}</td><td>{event.action}</td>
        <td>{event.actor_id}</td></tr>)}</tbody>
      </table>}</section>}
    {message&&<p role="status">{message}</p>}
   </section>
  </main>
 </div>;
}
