'use client';
import {useEffect,useState} from 'react';
import {PlatformSidebar} from '../../components/PlatformSidebar';

type Company={id:string;name:string;slug:string};
type Pref={feature_key:string;enabled:boolean};
const features=[
 ['ai_assistant','Asistente IA'],['whatsapp','WhatsApp'],['instagram','Instagram'],
 ['messenger','Messenger'],['automations','Automatizaciones'],
 ['catalog_pdf','Catálogos PDF'],['native_orders','Pedidos'],
 ['merchant_payments','Pasarela de pagos'],['statistics','Estadísticas'],
] as const;
export default function FeaturePreferencesPage(){
 const [companies,setCompanies]=useState<Company[]>([]);
 const [selected,setSelected]=useState('');
 const [prefs,setPrefs]=useState<Pref[]>([]);
 const [rights,setRights]=useState<Record<string,unknown>|null>(null);
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState('');
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 useEffect(()=>{
  (async()=>{
   try{
    const me=await fetch('/api/platform-admin/me',{cache:'no-store'}).then(r=>r.json());
    if(me.platformAdmin!==true)throw new Error('Acceso exclusivo al Super Admin.');
    const res=await fetch('/api/platform-admin/companies',{cache:'no-store'});
    const data=await res.json();
    if(!res.ok||!data.ok)throw new Error(data.error||'No se pudieron consultar empresas.');
    setCompanies(data.companies||[]);
   }catch(e){setError(e instanceof Error?e.message:'Error al cargar');}
   finally{setLoading(false);}
  })();
 },[]);
 useEffect(()=>{
  if(!selected){setPrefs([]);setRights(null);return;}
  let ignore=false;
  (async()=>{
   setError('');setNotice('');
   try{
    const res=await fetch('/api/platform-admin/feature-preferences?companyId='+encodeURIComponent(selected),{cache:'no-store'});
    const data=await res.json();
    if(!res.ok||!data.ok)throw new Error(data.error||'Error al consultar.');
    if(!ignore){setPrefs(data.preferences||[]);setRights(data.entitlements||null);}
   }catch(e){if(!ignore)setError(e instanceof Error?e.message:'Error');}
  })();
  return ()=>{ignore=true;};
 },[selected]);
 async function toggle(key:string,enabled:boolean){
  if(busy)return;
  setBusy(key);setError('');setNotice('');
  try{
   const response=await fetch('/api/platform-admin/feature-preferences',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({companyId:selected,featureKey:key,enabled}),
   });
   const data=await response.json();
   if(!response.ok||!data.ok)throw new Error(data.error||'No se pudo guardar.');
   setPrefs(prev=>[...prev.filter(p=>p.feature_key!==key),{feature_key:key,enabled}]);
   setNotice('Preferencia guardada en staging. No modifica módulos operativos.');
  }catch(e){setError(e instanceof Error?e.message:'Error');}
  finally{setBusy('');}
 }
 return <div style={{minHeight:'100vh',background:'#f5f7fb',color:'#142238'}}>
  <PlatformSidebar/>
  <main style={{marginLeft:196,padding:'35px 24px',maxWidth:1000}}>
   <h1>Funciones por empresa</h1>
   <p>Control de preferencias de MW1 — entorno de pruebas.</p>
   <p style={{padding:14,background:'#fff0cc',borderRadius:8}}>
    Estos interruptores <strong>guardan preferencias únicamente</strong>. Todavía no
    activan, desactivan ni bloquean funciones reales. Las conexiones manuales
    de ATOGOB y MAOGO no se modifican.
   </p>
   {loading?<p>Cargando empresas…</p>:<label style={{display:'grid',gap:8,maxWidth:460}}>
    Empresa
    <select aria-label="Seleccionar empresa" value={selected} onChange={e=>setSelected(e.target.value)}
      style={{padding:12,borderRadius:8}}>
      <option value="">Selecciona una empresa</option>
      {companies.map(c=><option key={c.id} value={c.id}>{c.name} ({c.slug})</option>)}
    </select>
   </label>}
   {error&&<p role="alert" style={{color:'#b91c1c'}}>{error}</p>}
   {notice&&<p role="status" style={{color:'#166534'}}>{notice}</p>}
   {selected&&<section style={{display:'grid',gap:10,marginTop:24,maxWidth:620}}>
    {features.map(([key,label])=>{
     const saved=prefs.find(p=>p.feature_key===key);
     const field:Record<string,string>={
       ai_assistant:'ai_enabled',whatsapp:'whatsapp_enabled',
       instagram:'instagram_enabled',messenger:'messenger_enabled',
       automations:'automations_enabled',native_orders:'native_orders_enabled',
       statistics:'statistics_enabled',
     };
     const grant=field[key] && rights ? rights[field[key]] : null;
     const entitlement=grant===true?'Incluido en el plan':grant===false?'No incluido en el plan':'Pendiente de definición comercial';
     return <div key={key} style={{display:'flex',alignItems:'center',
       justifyContent:'space-between',padding:15,background:'#fff',borderRadius:10}}>
      <div><strong>{label}</strong><div style={{fontSize:12,color:'#64748b'}}>
       {entitlement} · {saved?'Preferencia guardada':'Sin preferencia: conservar comportamiento actual'}
      </div></div>
      <button type="button" disabled={Boolean(busy)} onClick={()=>toggle(key,saved?.enabled===true?false:true)}
       aria-label={label+': '+(saved? (saved.enabled?'activado':'desactivado'):'sin configurar')}
       aria-pressed={saved?.enabled===true}
       style={{minWidth:105,padding:'10px 12px',border:0,borderRadius:24,
         color:saved?.enabled?'white':'#334155',
         background:saved?.enabled?'#16835d':'#e2e8f0',cursor:'pointer'}}>
       {busy===key?'Guardando…':!saved?'— Sin configurar':saved.enabled?'● Activado':'○ Apagado'}
      </button>
     </div>;
    })}
   </section>}
  </main>
 </div>;
}
