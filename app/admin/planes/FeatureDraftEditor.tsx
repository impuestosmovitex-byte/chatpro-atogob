'use client';
import {useEffect,useState} from 'react';
type Tier='basico'|'eco'|'pro';
type Status='included'|'not_included'|'pending';
type Rights=Record<string,Status>;
const features=[
 ['whatsapp','WhatsApp'],['ai_assistant','Asistente IA'],['instagram','Instagram'],
 ['messenger','Messenger'],['automations','Automatizaciones'],
 ['statistics','Estadísticas'],['catalog_pdf','Catálogos PDF'],
 ['native_orders','Pedidos nativos'],['merchant_payments','Pasarela de pagos'],
] as const;
const tiers:Tier[]=['basico','eco','pro'];
function initial(tier:Tier):Rights{
 const result:Rights={};
 for(const [key] of features){
  result[key]='pending';
  if(key==='whatsapp')result[key]='included';
  if(['ai_assistant','instagram','messenger','automations'].includes(key))
   result[key]=tier==='basico'?'not_included':'included';
  if(key==='statistics'&&tier!=='basico')result[key]='included';
 }
 return result;
}
export default function FeatureDraftEditor(){
 const [matrix,setMatrix]=useState<Record<Tier,Rights>>({
  basico:initial('basico'),eco:initial('eco'),pro:initial('pro'),
 });
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState<Tier|null>(null);
 const [dirty,setDirty]=useState<Record<Tier,boolean>>({basico:false,eco:false,pro:false});
 const [notice,setNotice]=useState('');
 const [savedAt,setSavedAt]=useState<Record<Tier,string>>({basico:'',eco:'',pro:''});
 const [approved,setApproved]=useState<Record<Tier,string>>({basico:'',eco:'',pro:''});
 const [reviewStatus,setReviewStatus]=useState<Record<Tier,'draft'|'ready'>>({basico:'draft',eco:'draft',pro:'draft'});
 useEffect(()=>{
  (async()=>{
   try{
    const response=await fetch('/api/platform-admin/commercial-feature-drafts',{cache:'no-store'});
    const data=await response.json();
    if(!response.ok||!data.ok)throw new Error(data.error||'Error cargando borradores.');
    setSavedAt(previous=>{const next={...previous};for(const d of data.drafts||[]){if(tiers.includes(d.tier as Tier))next[d.tier as Tier]=d.updated_at;}return next;});
    setMatrix(previous=>{
     const updated={...previous};
     for(const draft of data.drafts||[]){
      if(tiers.includes(draft.tier as Tier)){const tier=draft.tier as Tier;updated[tier]={...initial(tier),...draft.rights};}
     }
     return updated;
    });
    const approvalsResponse=await fetch('/api/platform-admin/commercial-feature-approvals',{cache:'no-store'});
    if(approvalsResponse.ok){const approvalsData=await approvalsResponse.json();setApproved(previous=>{const next={...previous};for(const a of approvalsData.approvals||[]){if(tiers.includes(a.tier as Tier))next[a.tier as Tier]=a.draft_updated_at;}return next;});}
   }catch(e){setNotice(e instanceof Error?e.message:'No se pudo cargar la matriz.');}
   finally{setLoading(false);}
  })();
 },[]);
 function change(tier:Tier,key:string,value:Status){
  setMatrix(previous=>({...previous,[tier]:{...previous[tier],[key]:value}}));
  setDirty(previous=>({...previous,[tier]:true}));
  setReviewStatus(previous=>({...previous,[tier]:'draft'}));
  setNotice('');
 }
 async function save(tier:Tier){
  setBusy(tier);setNotice('');
  try{
   const response=await fetch('/api/platform-admin/commercial-feature-drafts',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({tier,rights:matrix[tier]})});
   const data=await response.json();
   if(!response.ok||!data.ok)throw new Error(data.error||'No se pudo guardar.');
   setSavedAt(previous=>({...previous,[tier]:data.draft.updated_at}));
   setDirty(previous=>({...previous,[tier]:false}));
   setReviewStatus(previous=>({...previous,[tier]:features.some(([key])=>matrix[tier][key]==='pending')?'draft':'ready'}));
   setNotice('Borrador de '+tier+' guardado. No modifica permisos reales.');
  }catch(e){setNotice(e instanceof Error?e.message:'Error al guardar.');}
  finally{setBusy(null);}
 }
 async function approve(tier:Tier){
  if(dirty[tier]||!savedAt[tier]||features.some(([key])=>matrix[tier][key]==='pending'))return;
  if(!window.confirm('¿Aprobar la matriz comercial de '+tier.toUpperCase()+'? Esta acción registra tu aprobación interna, sin conceder permisos a empresas ni activar cobros.'))return;
  setBusy(tier);setNotice('');
  try{
   const response=await fetch('/api/platform-admin/commercial-feature-approvals',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({tier,draftUpdatedAt:savedAt[tier],confirm:'APROBAR BORRADOR COMERCIAL'})});
   const data=await response.json();
   if(!response.ok||!data.ok)throw new Error(data.error||'No se pudo aprobar.');
   setApproved(prev=>({...prev,[tier]:savedAt[tier]}));
   setNotice('Aprobación comercial interna registrada para '+tier+'. No se han aplicado permisos.');
  }catch(e){setNotice(e instanceof Error?e.message:'Error al aprobar.');}
  finally{setBusy(null);}
 }
 return <section style={{padding:18,background:'#fff',border:'1px solid #dbe3ef',borderRadius:12,margin:'20px 0'}}>
  <h2>Matriz editable de funciones · borradores</h2>
  <p style={{fontSize:13,color:'#64748b'}}>Los cambios quedan guardados únicamente para revisión comercial.
   No publican derechos, no activan cobros ni desconectan empresas.</p>
  {notice&&<p role="status">{notice}</p>}
  {loading?<p>Cargando matriz…</p>:<>
   <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
    <thead><tr><th style={{textAlign:'left',padding:10}}>Función</th>
     {tiers.map(t=><th key={t} style={{textTransform:'capitalize',padding:10}}>{t}</th>)}</tr></thead>
    <tbody>{features.map(([key,label])=><tr key={key} style={{borderTop:'1px solid #e2e8f0'}}>
     <td style={{padding:10}}>{label}</td>
     {tiers.map(t=><td key={t} style={{padding:6}}>
      <select aria-label={label+' '+t} value={matrix[t][key]} disabled={busy!==null}
       onChange={event=>change(t,key,event.target.value as Status)}
       style={{maxWidth:160,width:'100%',padding:7,borderRadius:7}}>
       <option value="included">Incluido</option>
       <option value="not_included">No incluido</option>
       <option value="pending">Pendiente</option>
      </select>
     </td>)}</tr>)}</tbody>
   </table></div>
   <p style={{fontSize:12,color:'#64748b'}}>Estado de revisión local: una matriz sin funciones pendientes puede marcarse como lista para revisión, pero nunca queda aprobada ni publicada con este guardado.</p>
   <div style={{display:'flex',gap:12,flexWrap:'wrap',fontSize:13}}>
    {tiers.map(t=><span key={t}><strong>{t.toUpperCase()}:</strong> {dirty[t]?'Cambios sin guardar':reviewStatus[t]==='ready'?'Lista para revisión interna':'Borrador pendiente'}</span>)}
   </div>
   <div style={{display:'flex',gap:10,flexWrap:'wrap',marginTop:16}}>
    {tiers.map(t=><button key={t} type="button" disabled={!dirty[t]||busy!==null}
     onClick={()=>void save(t)}
     style={{padding:'10px 14px',background:'#172235',color:'white',border:0,borderRadius:8,opacity:!dirty[t]?0.5:1}}>
     {busy===t?'Guardando…':'Guardar '+t+(dirty[t]?' *':'')}
    </button>)}
   </div>
   <p style={{fontSize:12,color:'#64748b'}}>Aprobación interna: requiere guardar primero y definir todas las funciones. No habilita módulos reales.</p>
   <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
    {tiers.map(t=><button key={t} type="button"
     disabled={busy!==null||dirty[t]||!savedAt[t]||features.some(([key])=>matrix[t][key]==='pending')||approved[t]===savedAt[t]}
     onClick={()=>void approve(t)}
     style={{padding:'10px 14px',border:'1px solid #172235',background:'white',color:'#172235',borderRadius:8}}>
     {approved[t]===savedAt[t]?'Aprobado internamente: '+t:'Revisar y aprobar '+t}
    </button>)}
   </div>
  </>}
 </section>;
}
