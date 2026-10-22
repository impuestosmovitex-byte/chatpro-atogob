'use client';
import Link from 'next/link';
import {useEffect,useState,type FormEvent} from 'react';
import {AppSidebar} from '../../components/AppSidebar';

type Key='inicial'|'pro'|'empresa';
type Plan={
  planKey:Key;priceCop:number|null;maxUsers:number|null;maxWhatsappLines:number|null;
  aiEnabled:boolean;whatsappEnabled:boolean;instagramEnabled:boolean;
  messengerEnabled:boolean;automationsEnabled:boolean;statisticsEnabled:boolean;
  notes:string;reviewStatus:'draft'|'ready_for_review';
};
const names:Record<Key,string>={inicial:'Inicial',pro:'Pro',empresa:'Empresa'};
const keys:Key[]=['inicial','pro','empresa'];
const initial=(planKey:Key):Plan=>({
  planKey,priceCop:null,maxUsers:null,maxWhatsappLines:null,
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
  const [selected,setSelected]=useState<Key>('inicial');
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
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
          setPlans(keys.map(key=>data.plans!.find(p=>p.planKey===key)||initial(key)));
        }
      }catch(cause){
        if(active)setError(cause instanceof Error?cause.message:'Error consultando los planes.');
      }finally{if(active)setLoaded(true);}
    })();
    return()=>{active=false;};
  },[]);
  const plan=plans.find(p=>p.planKey===selected)||initial(selected);
  const update=<K extends keyof Plan>(field:K,value:Plan[K])=>{
    setPlans(old=>old.map(p=>p.planKey===selected?{...p,[field]:value}:p));
    setNotice('');
  };
  const updateNumber=(field:'priceCop'|'maxUsers'|'maxWhatsappLines',raw:string)=>{
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
      setNotice(data.message||'Borrador guardado.');
    }catch(cause){
      setError(cause instanceof Error?cause.message:'No se guardó el borrador.');
    }finally{setSaving(false);}
  }
  return <div style={{background:'#f5f6f8',minHeight:'100vh',color:'#172235'}}>
    <AppSidebar/>
    <main style={{maxWidth:1250,marginLeft:160,padding:'38px 42px 80px'}}>
      <p style={{fontSize:12,fontWeight:800,color:'#957020',letterSpacing:1.3}}>
        SUPER ADMIN MW1 · PLANES COMERCIALES
      </p>
      <h1 style={{fontSize:34,margin:'10px 0'}}>Definir planes</h1>
      <p style={{color:'#667085',maxWidth:750}}>
        Trabaja en las propuestas Inicial, Pro y Empresa. Los borradores no modifican
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
          <p style={{fontSize:13,color:'#667085',marginBottom:20}}>
            Moneda: COP. No se mostrará ningún importe al público hasta aprobarlo
            y construir la publicación controlada.
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
                placeholder="Por definir"
                value={plan[field]??''} onChange={event=>updateNumber(field,event.target.value)}/>
            </label>)}
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
          <button type="submit" disabled={saving}
            style={{padding:'12px 20px',borderRadius:10,border:0,
              color:'white',background:'#172235',cursor:'pointer',
              fontWeight:700}}>
            {saving?'Guardando…':'Guardar borrador privado'}
          </button>
        </form>
      </div>}
    </main>
  </div>;
}
