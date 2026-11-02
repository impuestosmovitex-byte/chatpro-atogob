'use client';
import {useEffect,useState} from 'react';
import {PlatformSidebar} from '../../components/PlatformSidebar';
type Company={id:string;name:string};
type Draft={company_id:string;tier:string;notes:string};
export default function AssignmentDraftPage(){
 const [companies,setCompanies]=useState<Company[]>([]);
 const [drafts,setDrafts]=useState<Draft[]>([]);
 const [companyId,setCompanyId]=useState('');
 const [tier,setTier]=useState('basico');
 const [notes,setNotes]=useState('');
 const [message,setMessage]=useState('');
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
 function selectCompany(id:string){
  setCompanyId(id);
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
    {message&&<p role="status">{message}</p>}
   </section>
  </main>
 </div>;
}
