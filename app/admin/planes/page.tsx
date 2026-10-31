'use client';
import Link from 'next/link';
import {useEffect,useState,type FormEvent} from 'react';
import {PlatformSidebar} from '../../components/PlatformSidebar';
import {MW1_COMMERCIAL_PROPOSAL,MW1_EXTRA_USER_PREVIEW_COP,MW1_EXTRA_CONNECTION_PREVIEW_COP} from '../../lib/mw1-commercial-proposal';

type Key='inicial'|'pro'|'empresa';
type PublishedPlan={
 plan_key:Key;price_cop:number;max_users:number;max_whatsapp_lines:number;
 extra_user_cop:number|null;extra_connection_cop:number|null;
 public_summary:string|null;public_features:string[]|null;published_at:string;
};
type Plan={
  planKey:Key;priceCop:number|null;maxUsers:number|null;maxWhatsappLines:number|null;
  extraUserCop:number|null;extraConnectionCop:number|null;
  aiMonthlyBudgetCop:number|null;publicSummary:string;publicFeatures:string[];
  aiEnabled:boolean;whatsappEnabled:boolean;instagramEnabled:boolean;
  messengerEnabled:boolean;automationsEnabled:boolean;statisticsEnabled:boolean;
  notes:string;reviewStatus:'draft'|'ready_for_review';
};
// Legacy database keys remain intact; display labels come from the shared commercial proposal.
const names:Record<Key,string>={inicial:'Básico',pro:'Eco',empresa:'Pro'};
const suggested:Record<Key,{price:number;users:number;lines:number;description:string}>=Object.fromEntries(
 MW1_COMMERCIAL_PROPOSAL.map(p=>[p.legacyKey,{price:p.price,users:p.users,lines:p.connections,description:p.summary}])
) as Record<Key,{price:number;users:number;lines:number;description:string}>;
const keys:Key[]=['inicial','pro','empresa'];
const initial=(planKey:Key):Plan=>({
  planKey,priceCop:null,maxUsers:null,maxWhatsappLines:null,
  extraUserCop:null,extraConnectionCop:null,
  aiMonthlyBudgetCop:null,publicSummary:'',publicFeatures:[],
  aiEnabled:false,whatsappEnabled:false,instagramEnabled:false,
  messengerEnabled:false,automationsEnabled:false,statisticsEnabled:false,
  notes:'',reviewStatus:'draft',
});
const flagNames:Record<keyof Pick<Plan,'aiEnabled'|'whatsappEnabled'|
  'instagramEnabled'|'messengerEnabled'|'automationsEnabled'|'statisticsEnabled'>,string>={
    aiEnabled:'IA de ventas y servicio',whatsappEnabled:'WhatsApp',
    instagramEnabled:'Instagram',messengerEnabled:'Messenger',
    automationsEnabled:'Automatizaciones',statisticsEnabled:'Estadísticas',
  };
const flagKeys=Object.keys(flagNames) as Array<keyof typeof flagNames>;
const control={padding:'11px 12px',fontSize:14,border:'1px solid #d9dde5',
  borderRadius:9,width:'100%',background:'#fff'};
export default function AdminPlansPage(){
  const [authorized,setAuthorized]=useState(false);
  const [loaded,setLoaded]=useState(false);
  const [plans,setPlans]=useState<Plan[]>(keys.map(initial));
  const [featureTexts,setFeatureTexts]=useState<Partial<Record<Key,string>>>({});
  const [savedPlans,setSavedPlans]=useState<Plan[]>(keys.map(initial));
  const [selected,setSelected]=useState<Key>('inicial');
  const [saving,setSaving]=useState(false);
  const [publishing,setPublishing]=useState(false);
  const [previewUsers,setPreviewUsers]=useState(3);
  const [previewConnections,setPreviewConnections]=useState(3);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [publishedPlans,setPublishedPlans]=useState<PublishedPlan[]>([]);
  const [publicationError,setPublicationError]=useState('');
  const [publishedChecked,setPublishedChecked]=useState(false);
  async function reloadPublished(){
    const response=await fetch('/api/platform-admin/plan-published',{cache:'no-store'});
    const data=await response.json() as {ok?:boolean;plans?:PublishedPlan[];error?:string};
    if(!response.ok||!data.ok||!Array.isArray(data.plans))
      throw new Error(data.error||'No fue posible verificar los precios publicados.');
    setPublishedPlans(data.plans);
    setPublicationError('');
    setPublishedChecked(true);
  }
  useEffect(()=>{
    let active=true;
    (async()=>{
      try{
        const me=await fetch('/api/platform-admin/me',{cache:'no-store'});
        const session=await me.json() as {ok?:boolean;platformAdmin?:boolean};
        if(!me.ok||session.platformAdmin!==true)throw Error('Acceso exclusivo de Super Admin.');
        if(!active)return;
        setAuthorized(true);
        const response=await fetch('/api/platform-admin/plan-drafts',{cache:'no-store'});
        const data=await response.json() as {ok?:boolean;error?:string;plans?:Plan[]};
        if(!response.ok||!data.ok)throw Error(data.error||'No se pudieron cargar los planes.');
        if(active&&Array.isArray(data.plans)){
          const loadedPlans=keys.map(key=>data.plans!.find(p=>p.planKey===key)||initial(key));
          setPlans(loadedPlans);
          setSavedPlans(loadedPlans);
          setFeatureTexts(Object.fromEntries(loadedPlans.map(p=>[p.planKey,p.publicFeatures.join('\n')])) as Partial<Record<Key,string>>);
          void reloadPublished().catch(e=>{setPublishedChecked(true);setPublicationError(e instanceof Error?e.message:'No se pudo verificar la publicación.');});
        }
      }catch(cause){
        if(active)setError(cause instanceof Error?cause.message:'Error consultando los planes.');
      }finally{if(active)setLoaded(true);}
    })();
    return()=>{active=false;};
  },[]);
  const plan=plans.find(p=>p.planKey===selected)||initial(selected);
  const savedPlan=savedPlans.find(p=>p.planKey===selected)||initial(selected);
  const hasUnsavedChanges=JSON.stringify(plan)!==JSON.stringify(savedPlan);
  const missingPublicationRequirements=[
    ...(!Number.isSafeInteger(plan.priceCop)||!plan.priceCop||plan.priceCop<=0?['Definir un precio mensual válido.']:[]),
    ...(!Number.isSafeInteger(plan.maxUsers)||!plan.maxUsers||plan.maxUsers<=0?['Definir los usuarios incluidos.']:[]),
    ...(!Number.isSafeInteger(plan.maxWhatsappLines)||!plan.maxWhatsappLines||plan.maxWhatsappLines<=0?['Definir las líneas de WhatsApp incluidas.']:[]),
    ...(!plan.whatsappEnabled?['Habilitar WhatsApp en las capacidades del plan.']:[]),
    ...(plan.reviewStatus!=='ready_for_review'?['Cambiar Estado interno a «Listo para revisión».']:[]),
    ...(plan.extraUserCop===null||!Number.isSafeInteger(plan.extraUserCop)||plan.extraUserCop<0?['Definir el precio mensual por usuario adicional (puede ser cero).']:[]),
    ...(plan.extraConnectionCop===null||!Number.isSafeInteger(plan.extraConnectionCop)||plan.extraConnectionCop<0?['Definir el precio mensual por conexión adicional (puede ser cero).']:[]),
    ...(hasUnsavedChanges?['Guardar los cambios después de completar lo anterior.']:[]),
  ];
  const publicationAvailable=authorized&&!saving&&!publishing&&missingPublicationRequirements.length===0;
  function prepareForReview(){
    const defaults=suggested[selected];
    setPlans(old=>old.map(p=>p.planKey===selected?{
      ...p,
      priceCop:p.priceCop&&p.priceCop>0?p.priceCop:defaults.price,
      maxUsers:p.maxUsers&&p.maxUsers>0?p.maxUsers:defaults.users,
      maxWhatsappLines:p.maxWhatsappLines&&p.maxWhatsappLines>0?p.maxWhatsappLines:defaults.lines,
      whatsappEnabled:true,reviewStatus:'ready_for_review',
    }:p));
    setNotice('Requisitos completados en el formulario. Se conserva tu precio si ya lo definiste. Ahora pulsa «Guardar borrador privado» y luego «Publicar precio en staging».');
  }
  const publishedPlan=publishedPlans.find(p=>p.plan_key===selected);
  const savedDiffersFromPublished=!!publishedPlan && (
    plan.priceCop!==publishedPlan.price_cop||
    plan.maxUsers!==publishedPlan.max_users||
    plan.maxWhatsappLines!==publishedPlan.max_whatsapp_lines||
    plan.extraUserCop!==publishedPlan.extra_user_cop||
    plan.extraConnectionCop!==publishedPlan.extra_connection_cop||
    plan.publicSummary!==(publishedPlan.public_summary??'')||
    JSON.stringify(plan.publicFeatures)!==JSON.stringify(publishedPlan.public_features??[])
  );
  const update=<K extends keyof Plan>(field:K,value:Plan[K])=>{
    setPlans(old=>old.map(p=>p.planKey===selected?{...p,[field]:value}:p));
    setNotice('');
  };
  const updateNumber=(field:'priceCop'|'maxUsers'|'maxWhatsappLines'|'extraUserCop'|'extraConnectionCop'|'aiMonthlyBudgetCop',raw:string)=>{
    update(field,raw.trim()===''?null:Number(raw));
  };
  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(saving||!authorized)return;
    setSaving(true);setError('');setNotice('');
    try{
      const res=await fetch('/api/platform-admin/plan-drafts',{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify(plan),
      });
      const data=await res.json() as {ok?:boolean;error?:string;message?:string};
      if(!res.ok||!data.ok)throw Error(data.error||'No fue posible guardar.');
      setSavedPlans(old=>old.map(p=>p.planKey===selected?plan:p));
      setNotice(data.message||'Borrador guardado.');
    }catch(cause){
      setError(cause instanceof Error?cause.message:'No se guardó el borrador.');
    }finally{setSaving(false);}
  }
  async function publish(){
    if(!publicationAvailable)return;
    if(!window.confirm(`Vas a publicar en staging el plan ${names[selected]}:\n\nPrecio mensual: ${plan.priceCop?.toLocaleString('es-CO')} COP\nUsuarios incluidos: ${plan.maxUsers}\nConexiones incluidas: ${plan.maxWhatsappLines}\nUsuario adicional/mes: ${plan.extraUserCop?.toLocaleString('es-CO')} COP\nConexión adicional/mes: ${plan.extraConnectionCop?.toLocaleString('es-CO')} COP\n\nEstos precios serán visibles para los clientes. No activan cobros ni cambian contratos. ¿Confirmas la publicación?`))return;
    setPublishing(true);setError('');setNotice('');
    try{
      const response=await fetch('/api/platform-admin/plan-publish',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({planKey:selected})});
      const result=await response.json() as {ok?:boolean;error?:string;message?:string};
      if(!response.ok||!result.ok)throw new Error(result.error||'No se pudo publicar.');
      setNotice(result.message||'Precio publicado en el entorno de pruebas.');
      void reloadPublished().catch(e=>setPublicationError(e instanceof Error?e.message:'No se pudo verificar la publicación.'));
    }catch(cause){setError(cause instanceof Error?cause.message:'No se pudo publicar.');}
    finally{setPublishing(false);}
  }
  return <div style={{background:'#f5f6f8',minHeight:'100vh',color:'#172235'}}>
    <PlatformSidebar/>
    <main style={{maxWidth:1250,marginLeft:176,padding:'38px 42px 80px'}}>
      <p style={{fontSize:12,fontWeight:800,color:'#957020',letterSpacing:1.3}}>
        SUPER ADMIN MW1 · PLANES COMERCIALES
      </p>
      <h1 style={{fontSize:34,margin:'10px 0'}}>Definir planes</h1>
      <p style={{color:'#667085',maxWidth:750}}>
        Trabaja en las propuestas Básico, Eco y Pro. Los borradores no modifican
        los límites de ninguna compañía ni publican precios. No activan cobros.
      </p>
      <p><Link href="/admin/empresas">← Volver a empresas</Link> ·
        <Link href="/precios"> Consultar la página comercial</Link></p>
      {!loaded&&<p>Verificando acceso de superadministrador…</p>}
      {error&&<p role="alert" style={{color:'#a32323',padding:12,
        background:'#fff1f1',borderRadius:8}}>{error}</p>}
      {notice&&<p role="status" style={{color:'#12623a',padding:12,
        background:'#ecf8f1',borderRadius:8}}>{notice}</p>}
      {loaded&&authorized&&<div style={{background:'white',marginTop:22,
        border:'1px solid #e4e6eb',borderRadius:16,padding:24}}>
        <div role="group" aria-label="Seleccionar plan" style={{display:'flex',
          flexWrap:'wrap',gap:8,marginBottom:22}}>
          {keys.map(key=><button key={key} type="button"
            onClick={()=>{setSelected(key);setError('');setNotice('');}}
            aria-pressed={selected===key}
            style={{borderRadius:9,border:'1px solid #d9dde5',padding:'10px 19px',
              background:selected===key?'#172235':'white',
              color:selected===key?'white':'#172235',cursor:'pointer'}}>
            {names[key]}
          </button>)}
        </div>
        <form onSubmit={event=>void save(event)}>
          <h2 style={{fontSize:22,marginBottom:6}}>{names[selected]}</h2>
          <p style={{fontSize:13,color:'#667085'}}>Referencia comercial: {suggested[selected].price.toLocaleString('es-CO')} COP al mes; {suggested[selected].users} usuarios y {suggested[selected].lines} conexiones. {suggested[selected].description}</p>
          <p style={{fontSize:12,color:'#926100'}}>Los nombres comerciales son nuevos; se mantienen las claves internas por seguridad. Las referencias no se guardan automáticamente.</p>
          <section aria-label="Estado de publicación" style={{background:'#f2f5fa',border:'1px solid #dbe2ee',padding:15,borderRadius:11,margin:'14px 0'}}>
            <strong>Lo que ve el cliente en la web de pruebas</strong>
            {publicationError?<p role="alert" style={{color:'#a32c2c',fontSize:13}}>No se pudo verificar el estado: {publicationError}</p>
            :!publishedChecked?<p style={{fontSize:13}}>Consultando publicación…</p>
            :!publishedPlan?<p style={{fontSize:13}}>Este plan aún no tiene una publicación aprobada. La web muestra la propuesta de referencia.</p>
            :<div style={{fontSize:13,lineHeight:1.7}}>
              <p><strong>Publicado:</strong> {publishedPlan.price_cop.toLocaleString('es-CO')} COP/mes · {publishedPlan.max_users} usuarios · {publishedPlan.max_whatsapp_lines} conexiones.</p>
              <p><strong>Última publicación:</strong> {new Date(publishedPlan.published_at).toLocaleString('es-CO')}</p>
              {savedDiffersFromPublished?<p style={{color:'#986000'}}>El formulario no coincide con lo publicado. Guarda y vuelve a publicar si deseas actualizar lo que ve el cliente.</p>:<p style={{color:'#166236'}}>Los valores comerciales del formulario coinciden con la publicación.</p>}
            </div>}
            <Link href="/precios" style={{fontSize:13}}>Abrir precios públicos →</Link>
          </section>
          <p style={{fontSize:13,color:'#667085',marginBottom:20}}>
            Moneda: COP. Los valores que ves aquí son borradores hasta que pulses
            «Publicar precio en staging». Solo entonces se actualizan las tarifas,
            cupos, descripción y beneficios en la página pública /precios.
            Esto no modifica los permisos ni la facturación de clientes.
          </p>
          <div style={{display:'grid',gridTemplateColumns:
            'repeat(auto-fit,minmax(220px,1fr))',gap:17,marginBottom:20}}>
            {([
              ['priceCop','Precio mensual en COP'],
              ['maxUsers','Usuarios incluidos'],
              ['maxWhatsappLines','Líneas de WhatsApp incluidas'],
            ] as const).map(([field,label])=><label key={field}
              style={{fontSize:13,fontWeight:650,display:'grid',gap:7}}>
              {label}
              <input style={control} type="number" min={1}
                max={field==='priceCop'?999999999:1000} step={1}
                placeholder={String(field==='priceCop'?suggested[selected].price:field==='maxUsers'?suggested[selected].users:suggested[selected].lines)}
                value={plan[field]??''} onChange={event=>updateNumber(field,event.target.value)}/>
            </label>)}
          </div>
          <h3 style={{marginBottom:12}}>Tarifas adicionales del plan</h3>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:17,marginBottom:20}}>
            {([['extraUserCop','Usuario adicional al mes'],['extraConnectionCop','Conexión adicional al mes']] as const).map(([field,label])=>
              <label key={field} style={{fontSize:13,fontWeight:650,display:'grid',gap:7}}>
                {label} (COP)
                <input style={control} type="number" min={0} max={999999999} step={1}
                  placeholder={field==='extraUserCop'?'32000':'50000'}
                  value={plan[field]??''} onChange={e=>updateNumber(field,e.target.value)}/>
              </label>)}
          </div>
          <div style={{padding:16,margin:'0 0 20px',border:'1px solid #e2e8f0',borderRadius:12,background:'#f8fafc'}}>
            <strong>Simulador privado · vista previa comercial</strong>
            <p style={{fontSize:12,color:'#667085',margin:'8px 0'}}>Usa los valores del borrador cuando estén definidos; en caso contrario, muestra referencias provisionales.</p>
            <div style={{display:'flex',flexWrap:'wrap',gap:15,marginTop:12}}>
              <label>Usuarios a simular <input type="number" min={1} max={1000} style={{...control,width:120}} value={previewUsers} onChange={e=>setPreviewUsers(Math.max(1,Math.min(1000,Number(e.target.value)||1)))}/></label>
              <label>Conexiones a simular <input type="number" min={1} max={1000} style={{...control,width:120}} value={previewConnections} onChange={e=>setPreviewConnections(Math.max(1,Math.min(1000,Number(e.target.value)||1)))}/></label>
            </div>
            <p style={{marginTop:12,fontWeight:800}}>Total orientativo mensual: {((plan.priceCop??suggested[selected].price)+Math.max(0,previewUsers-(plan.maxUsers??suggested[selected].users))* (plan.extraUserCop??MW1_EXTRA_USER_PREVIEW_COP)+Math.max(0,previewConnections-(plan.maxWhatsappLines??suggested[selected].lines))* (plan.extraConnectionCop??MW1_EXTRA_CONNECTION_PREVIEW_COP)).toLocaleString('es-CO')} COP</p>
            <button type="button" onClick={() => {
              setPlans(old=>old.map(p=>p.planKey===selected?{...p,priceCop:suggested[selected].price,maxUsers:suggested[selected].users,maxWhatsappLines:suggested[selected].lines,reviewStatus:'draft'}:p));
              setNotice('Valores propuestos cargados localmente. Revisa y guarda el borrador si estás conforme.');
            }} style={{padding:'10px 14px',marginTop:9,borderRadius:9,background:'#172235',color:'white',border:0,cursor:'pointer'}}>Cargar valores sugeridos en el formulario</button>
          </div>
          <h3>Contenido comercial y presupuesto de IA</h3>
          <div style={{display:'grid',gap:14,margin:'14px 0 20px'}}>
            <label style={{display:'grid',gap:6,fontSize:13,fontWeight:650}}>Presupuesto mensual IA (COP) · referencia de costo, no límite técnico activo
              <input type="number" min={0} max={999999999} style={control}
                value={plan.aiMonthlyBudgetCop??''} onChange={e=>updateNumber('aiMonthlyBudgetCop',e.target.value)} placeholder="Pendiente de aprobación"/>
            </label>
            <label style={{display:'grid',gap:6,fontSize:13,fontWeight:650}}>Descripción breve visible en la web
              <textarea rows={2} maxLength={300} style={control} value={plan.publicSummary}
                onChange={e=>update('publicSummary',e.target.value)}
                placeholder={suggested[selected].description}/>
            </label>
            <label style={{display:'grid',gap:6,fontSize:13,fontWeight:650}}>Beneficios visibles en «Ver más» · uno por línea, máximo 20
              <textarea rows={7} maxLength={1500} style={control} value={featureTexts[selected]??plan.publicFeatures.join('\n')}
                onChange={e=>{const text=e.target.value;setFeatureTexts(old=>({...old,[selected]:text}));update('publicFeatures',text.split(/\r?\n/).map(v=>v.trim()).filter(Boolean).slice(0,20));}}
                placeholder="CRM y bandeja\nAtención humana\nSoporte técnico"/>
            </label>
            <p style={{fontSize:12,color:'#667085'}}>No incluyas funciones que todavía estén en desarrollo como si estuvieran disponibles. Los cambios requieren guardar y publicar en staging.</p>
          </div>
          <h3>Capacidades que se ofrecerían en este plan</h3>
          <div style={{display:'grid',gridTemplateColumns:
            'repeat(auto-fit,minmax(260px,1fr))',gap:12,margin:'16px 0 22px'}}>
            {flagKeys.map(field=><label key={field}
              style={{display:'flex',alignItems:'center',gap:10,fontSize:14}}>
              <input type="checkbox" checked={plan[field]}
                onChange={event=>update(field,event.target.checked)}/>
              {flagNames[field]}
            </label>)}
          </div>
          <label style={{display:'grid',gap:7,fontSize:13,fontWeight:650}}>
            Notas del plan y costos externos pendientes
            <textarea rows={4} style={control} maxLength={1400}
              value={plan.notes} onChange={event=>update('notes',event.target.value)}
              placeholder="Definir soporte, límites de mensajes, costos Meta/OpenAI y usuarios extra."/>
          </label>
          <label style={{display:'grid',gap:7,fontSize:13,fontWeight:650,margin:'20px 0'}}>
            Estado interno
            <select style={{...control,maxWidth:330}} value={plan.reviewStatus}
              onChange={event=>update('reviewStatus',
                event.target.value as Plan['reviewStatus'])}>
              <option value="draft">Borrador</option>
              <option value="ready_for_review">Listo para revisión interna</option>
            </select>
          </label>
          <p style={{fontSize:12,color:'#667085'}}>
            «Listo para revisión» no es un lanzamiento. Los cobros y la asignación
            de permisos requieren un flujo de pago verificado independiente.
          </p>
          <section style={{background:'#f7f9fc',border:'1px solid #dbe3ef',padding:15,borderRadius:11,margin:'12px 0 18px'}}>
            <strong>Requisitos para publicar este plan</strong>
            {missingPublicationRequirements.length===0?
              <p style={{color:'#17633b',fontSize:13}}>Todo listo. Puedes publicar este plan en staging con confirmación.</p>:
              <ul style={{fontSize:13,color:'#725400',lineHeight:1.7,paddingLeft:21}}>
                {missingPublicationRequirements.map(item=><li key={item}>{item}</li>)}
              </ul>}
            <button type="button" onClick={prepareForReview} disabled={saving||publishing}
              style={{padding:'10px 13px',border:'1px solid #c3cddd',borderRadius:8,cursor:'pointer',background:'#fff',color:'#172235',fontWeight:700}}>
              Completar requisitos sin cambiar mi precio
            </button>
            <p style={{fontSize:12,color:'#647188',marginBottom:0}}>
              Completa los campos vacíos con los cupos sugeridos y activa WhatsApp.
              Es una preparación local: no guarda ni publica por sí sola.
            </p>
          </section>
          <button type="submit" disabled={saving}
            style={{padding:'12px 20px',borderRadius:10,border:0,
              color:'white',background:'#172235',cursor:'pointer',
              fontWeight:700}}>
            {saving?'Guardando…':'Guardar borrador privado'}
          </button>
          <button type="button" onClick={()=>void publish()}
            disabled={!publicationAvailable}
            style={{padding:'12px 20px',borderRadius:10,marginLeft:12,border:'1px solid #172235',background:'white',color:'#172235',fontWeight:700,cursor:'pointer'}}>
            {publishing?'Publicando…':'Publicar precio en staging'}
          </button>
          {hasUnsavedChanges&&<p role="status" style={{fontSize:13,color:'#9a6700',marginTop:12}}>Hay cambios sin guardar. Guarda este plan antes de publicarlo en staging.</p>}
          <p style={{fontSize:12,color:'#667085',marginTop:12}}>Primero guarda el borrador con estado «Listo para revisión». Publicar actualiza precio, cupos y beneficios comerciales guardados; no concede permisos a clientes ni activa pagos.</p>
        </form>
      </div>}
    </main>
  </div>;
}
