'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {PlatformSidebar} from '../../components/PlatformSidebar';
type RequestRow={id:string;company_id:string;company:{name:string;slug:string}|null;request_type:string;requested_plan_key:string|null;status:string;created_at:string;note:string|null};
export default function SolicitudesSuscripcion(){
 const [items,setItems]=useState<RequestRow[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [notes,setNotes]=useState<Record<string,string>>({}),[processing,setProcessing]=useState(''),[notice,setNotice]=useState('');
 async function review(id:string,decision:'approved'|'rejected'){
  const note=(notes[id]||'').trim();if(!note){setError('Escribe el motivo de la decisión.');return;}
  if(!window.confirm('¿Confirmas esta decisión? Se registrará sin modificar el plan ni generar cobros.'))return;
  setProcessing(id);setError('');setNotice('');
  try{const r=await fetch('/api/admin/subscription-requests',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestId:id,decision,note})});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.message||d.error||'No se pudo guardar la decisión.');setNotice(d.message||'Decisión registrada.');await load();}catch(e){setError(e instanceof Error?e.message:'No se pudo guardar.')}finally{setProcessing('')}
 }
 async function load(){setLoading(true);setError('');try{
  const r=await fetch('/api/admin/subscription-requests',{cache:'no-store'});const d=await r.json();
  if(!r.ok||!d.ok)throw new Error(d.error||'No se pudieron cargar solicitudes.');
  setItems(d.requests??[]);
 }catch(e){setError(e instanceof Error?e.message:'No se pudieron cargar solicitudes.')}finally{setLoading(false)}}
 useEffect(()=>{void load()},[]);
 return <main style={{minHeight:'100vh',background:'#f6f7fa',color:'#172235'}}>
 <PlatformSidebar/>
 <section style={{marginLeft:176,padding:'36px 40px'}}>
  <p style={{fontSize:12,fontWeight:900,color:'#977313'}}>MW1 · SUPERADMINISTRADOR</p>
  <h1 style={{fontSize:30,margin:'12px 0'}}>Solicitudes de suscripción</h1>
  <p style={{color:'#677285',maxWidth:780}}>Bandeja de revisión de solicitudes enviadas por las empresas. Esta pantalla es de consulta: aún no cobra, cambia planes ni cancela servicios automáticamente.</p>
  <button onClick={()=>void load()} style={{margin:'20px 0',padding:'10px 16px',background:'#f4bf00',border:0,borderRadius:9,fontWeight:800}}>Actualizar</button>
  {notice&&<p role="status" style={{color:'#215c38'}}>{notice}</p>}
  {loading?<p>Cargando solicitudes…</p>:error?<p role="alert" style={{color:'#a52e33'}}>{error}</p>:
    items.length===0?<p>No hay solicitudes registradas.</p>:
    <div style={{display:'grid',gap:12}}>
    {items.map(x=><article key={x.id} style={{padding:18,background:'#fff',border:'1px solid #e6e1d5',borderRadius:12}}>
      <strong>{x.company?.name||'Empresa no encontrada'}</strong>
      <p style={{margin:'8px 0'}}>{x.request_type==='change_plan'?'Solicitud de cambio al plan '+(x.requested_plan_key||'sin especificar'):'Solicitud de cancelación de renovación'}</p>
      <p style={{color:'#657184'}}>Estado: {x.status==='pending'?'Pendiente de revisión':x.status==='approved'?'Aprobada':x.status==='rejected'?'Rechazada':'Retirada'} · {new Date(x.created_at).toLocaleString('es-CO')}</p>
      {x.note&&<p style={{marginTop:8}}>Nota: {x.note}</p>}
      {x.status==='pending'&&<div style={{marginTop:14,display:'grid',gap:10,maxWidth:650}}>
       <label htmlFor={'note-'+x.id}>Motivo de la decisión</label>
       <textarea id={'note-'+x.id} rows={2} value={notes[x.id]||''} onChange={e=>setNotes(v=>({...v,[x.id]:e.target.value}))} placeholder="Explica por qué se aprueba o rechaza la solicitud" style={{padding:10,border:'1px solid #ccc',borderRadius:8}}/>
       <div style={{display:'flex',gap:10}}><button disabled={processing===x.id||!(notes[x.id]||'').trim()} onClick={()=>void review(x.id,'approved')} style={{padding:'10px 14px',border:0,borderRadius:8,background:'#f4bf00',fontWeight:800}}>Aprobar solicitud</button><button disabled={processing===x.id||!(notes[x.id]||'').trim()} onClick={()=>void review(x.id,'rejected')} style={{padding:'10px 14px',border:'1px solid #ccc',borderRadius:8}}>Rechazar solicitud</button></div>
      </div>}
    </article>)}
    </div>}
  <p style={{marginTop:25}}><Link href="/admin/empresas">← Volver a Empresas</Link></p>
 </section></main>
}
