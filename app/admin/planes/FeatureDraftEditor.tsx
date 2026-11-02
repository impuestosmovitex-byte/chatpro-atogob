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
 useEffect(()=>{
  (async()=>{
   try{
    const response=await fetch('/api/platform-admin/commercial-feature-drafts',{cache:'no-store'});
    const data=await response.json();
    if(!response.ok||!data.ok)throw new Error(data.error||'Error cargando borradores.');
    setMatrix(previous=>{
     const updated={...previous};
     for(const draft of data.drafts||[]){
      if(tiers.includes(draft.tier as Tier)){const tier=draft.tier as Tier;updated[tier]={...initial(tier),...draft.rights};}
     }
     return updated;
    });
   }catch(e){setNotice(e instanceof Error?e.message:'No se pudo cargar la matriz.');}
   finally{setLoading(false);}
  })();
 },[]);
 function change(tier:Tier,key:string,value:Status){
  setMatrix(previous=>({...previous,[tier]:{...previous[tier],[key]:value}}));
  setDirty(previous=>({...previous,[tier]:true}));
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
   setDirty(previous=>({...previous,[tier]:false}));
   setNotice('Borrador de '+tier+' guardado. No modifica permisos reales.');
  }catch(e){setNotice(e instanceof Error?e.message:'Error al guardar.');}
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
   <div style={{display:'flex',gap:10,flexWrap:'wrap',marginTop:16}}>
    {tiers.map(t=><button key={t} type="button" disabled={!dirty[t]||busy!==null}
     onClick={()=>void save(t)}
     style={{padding:'10px 14px',background:'#172235',color:'white',border:0,borderRadius:8,opacity:!dirty[t]?0.5:1}}>
     {busy===t?'Guardando…':'Guardar '+t+(dirty[t]?' *':'')}
    </button>)}
   </div>
  </>}
 </section>;
}
