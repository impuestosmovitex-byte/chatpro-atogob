'use client';
import {useEffect,useMemo,useState} from 'react';
import Link from 'next/link';
import {PlatformSidebar} from '../../components/PlatformSidebar';

type Option={companySource:'operational'|'staging';companySlug:string;companyName:string;
 suggestedPlan:string|null;aiCostStatus:string;activityObservedAt:string|null;status:string};
type RecordDb={
 period_month:string;company_source:string;company_slug:string;
 billed_cop:string|number|null;received_cop:string|number|null;
 openai_cop:string|number|null;support_cop:string|number|null;
 onboarding_cop:string|number|null;other_direct_cop:string|number|null;
 include_in_allocation:boolean;allocation_weight:string|number;evidence_note:string;updated_at:string;
};
type Shared={
 railway_cop:string|number|null;supabase_cop:string|number|null;
 technical_support_cop:string|number|null;personnel_cop:string|number|null;
 marketing_cop:string|number|null;other_cop:string|number|null;
 openai_cop:string|number|null;updated_at:string;
};
type View={companies:Option[];records:RecordDb[];sharedActual:Shared|null;};
type Field='billedCop'|'receivedCop'|'openaiCop'|'supportCop'|'onboardingCop'|'otherDirectCop';
type Form=Record<Field,string>&{includeInAllocation:boolean;allocationWeight:number;evidenceNote:string};
const details=[
 ['billedCop','Valor facturado (COP)'],['receivedCop','Dinero realmente cobrado (COP)'],
 ['openaiCop','OpenAI directo (COP)'],['supportCop','Soporte directo (COP)'],
 ['onboardingCop','Configuración directa (COP)'],['otherDirectCop','Otros costos directos (COP)']
] as const;
const sharedFields=[
 ['railway_cop','Railway'],['supabase_cop','Supabase'],
 ['technical_support_cop','Soporte técnico compartido'],['personnel_cop','Personal'],
 ['marketing_cop','Publicidad'],['other_cop','Otros compartidos']
] as const;
const format=(value:number)=>new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(value);
const inputStyle={padding:'10px 11px',background:'white',borderRadius:9,border:'1px solid #cbd6e3',width:'100%'};
const blank=(option:Option):Form=>({billedCop:'',receivedCop:'',openaiCop:'',supportCop:'',
 onboardingCop:'',otherDirectCop:'',includeInAllocation:option.companySource==='operational',
 allocationWeight:1,evidenceNote:''});
const asText=(n:unknown)=>n===null||n===undefined?'':String(n);
const keyOf=(o:Option)=>o.companySource+':'+o.companySlug;
function defaultMonth(){
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Bogota',year:'numeric',month:'2-digit'}).formatToParts(new Date());
 const year=parts.find(p=>p.type==='year')?.value??'2026';
 const month=parts.find(p=>p.type==='month')?.value??'10';
 return year+'-'+month+'-01';
}
function toForm(o:Option,row:RecordDb|undefined):Form{
 if(!row)return blank(o);
 return {
  billedCop:asText(row.billed_cop),receivedCop:asText(row.received_cop),
  openaiCop:asText(row.openai_cop),supportCop:asText(row.support_cop),
  onboardingCop:asText(row.onboarding_cop),otherDirectCop:asText(row.other_direct_cop),
  includeInAllocation:row.include_in_allocation,allocationWeight:Number(row.allocation_weight),
  evidenceNote:row.evidence_note??'',
 };
}
const money=(txt:string):number|null=>txt.trim()===''?null:Number(txt);
const card={background:'white',border:'1px solid #dfe6f0',borderRadius:14,padding:20};

export default function RentabilidadEmpresas(){
 const [month,setMonth]=useState(defaultMonth);
 const [view,setView]=useState<View|null>(null);
 const [selected,setSelected]=useState('');
 const [drafts,setDrafts]=useState<Record<string,Form>>({});
 const [loading,setLoading]=useState(true);
 const [saving,setSaving]=useState(false);
 const [error,setError]=useState('');
 const [message,setMessage]=useState('');
 const [changed,setChanged]=useState<Record<string,boolean>>({});
 useEffect(()=>{
  let mounted=true;setLoading(true);setError('');setMessage('');
  void (async()=>{
   try{
    const r=await fetch('/api/platform-admin/finance/companies?month='+encodeURIComponent(month),{cache:'no-store'});
    const data=await r.json() as View&{ok?:boolean;error?:string};
    if(!r.ok||!data.ok||!Array.isArray(data.companies)||!Array.isArray(data.records))
     throw new Error(data.error||'No se pudo consultar el registro de empresas.');
    if(!mounted)return;
    setView(data);
    setSelected(old=>data.companies.some(o=>keyOf(o)===old)?old:(data.companies[0]?keyOf(data.companies[0]):''));
    setDrafts(Object.fromEntries(data.companies.map(o=>{
     const saved=data.records.find(x=>x.company_source===o.companySource&&x.company_slug===o.companySlug);
     return [keyOf(o),toForm(o,saved)];
    })));
    setChanged({});
   }catch(e){if(mounted)setError(e instanceof Error?e.message:'Error de consulta.');}
   finally{if(mounted)setLoading(false);}
  })();
  return()=>{mounted=false;};
 },[month]);
 const options=view?.companies??[];
 const active=options.find(o=>keyOf(o)===selected);
 const form=active?drafts[keyOf(active)]??blank(active):null;
 const sharedCosts=useMemo(()=>{
  const actual=view?.sharedActual;
  if(!actual)return null;
  const values=sharedFields.map(([field])=>actual[field]);
  if(values.some(n=>n===null||n===undefined))return null;
  return values.reduce<number>((sum,n)=>sum+Number(n),0);
 },[view]);
 const allocation=useMemo(()=>{
  if(!view)return {totalWeight:0,weights:new Map<string,number>()};
  const weights=new Map<string,number>();
  for(const company of options){
   const record=drafts[keyOf(company)]??blank(company);
   if(record.includeInAllocation)weights.set(keyOf(company),record.allocationWeight);
  }
  return {weights,totalWeight:Array.from(weights.values()).reduce((a,b)=>a+b,0)};
 },[view,options,drafts]);
 const calculate=(option:Option)=>{
  const entry=drafts[keyOf(option)]??blank(option);
  const direct=details.filter(([field])=>field!=='billedCop'&&field!=='receivedCop')
   .map(([field])=>money(entry[field]));
  const directCost=direct.some(v=>v===null)?null:direct.reduce<number>((sum,v)=>sum+(v??0),0);
  const allocated=sharedCosts!==null&&allocation.totalWeight>0&&entry.includeInAllocation?
   sharedCosts*entry.allocationWeight/allocation.totalWeight:
   !entry.includeInAllocation?0:null;
  const billed=money(entry.billedCop),received=money(entry.receivedCop);
  const complete=billed!==null&&directCost!==null&&allocated!==null;
  return {billed,received,directCost,allocated,
   result:complete?billed-directCost-allocated:null};
 };
 const activeResult=active?calculate(active):null;
 function edit(change:Partial<Form>){
  if(!active)return;
  const k=keyOf(active);setDrafts(old=>({...old,[k]:{...old[k],...change}}));
  setChanged(old=>({...old,[k]:true}));setMessage('');
 }
 async function save(){
  if(!active||!form)return;
  setSaving(true);setError('');setMessage('');
  try{
   const payload={
    periodMonth:month,companySource:active.companySource,companySlug:active.companySlug,
    ...Object.fromEntries(details.map(([k])=>[k,money(form[k])])),
    includeInAllocation:form.includeInAllocation,allocationWeight:form.allocationWeight,
    evidenceNote:form.evidenceNote,
   };
   const r=await fetch('/api/platform-admin/finance/companies',{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)
   });
   const data=await r.json() as {ok?:boolean;error?:string;message?:string};
   if(!r.ok||!data.ok)throw new Error(data.error||'No fue posible guardar el registro.');
   setChanged(old=>({...old,[selected]:false}));
   setMessage(data.message||'Registro guardado.');
  }catch(e){setError(e instanceof Error?e.message:'No fue posible guardar.');}
  finally{setSaving(false);}
 }
 const declared=options.filter(o=>money((drafts[keyOf(o)]??blank(o)).receivedCop)!==null);
 const allReceiptsKnown=declared.length===options.length&&options.length>0;
 const receipts=options.reduce((sum,o)=>sum+(money((drafts[keyOf(o)]??blank(o)).receivedCop)??0),0);
 return <div style={{minHeight:'100vh',background:'#f6f8fc',color:'#18283f'}}>
  <PlatformSidebar/>
  <main style={{marginLeft:176,padding:'34px 36px 80px',maxWidth:1430}}>
   <p style={{fontSize:12,color:'#926f19',fontWeight:850}}>SUPERADMIN MW1 · FINANZAS PRIVADAS</p>
   <h1 style={{fontSize:30,margin:'10px 0'}}>Rentabilidad por empresa</h1>
   <p style={{lineHeight:1.6,color:'#596b81',maxWidth:950}}>
    Control mensual por cliente. Las empresas operativas se muestran desde un directorio de solo lectura;
    guardar aquí no modifica sus planes, accesos, conversaciones, límites, facturas ni pagos.
   </p>
   <p><Link href="/admin/simulador-financiero">Simulador global y gastos mensuales</Link> · <Link href="/admin/empresas">Directorio de empresas</Link> · <Link href="/admin/consumo-ia">Consumo IA</Link></p>
   <label style={{display:'inline-grid',gap:7,fontWeight:750,fontSize:13,margin:'12px 0 22px'}}>
    Mes de análisis
    <input type="month" style={inputStyle} value={month.slice(0,7)}
     onChange={e=>{if(/^20[2-9][0-9]-(0[1-9]|1[0-2])$/.test(e.target.value))setMonth(e.target.value+'-01');}}/>
   </label>
   {error&&<p role="alert" style={{padding:14,color:'#a02727',background:'#fff3f1',borderRadius:9}}>{error}</p>}
   {message&&<p role="status" style={{padding:14,color:'#11623a',background:'#eef7f1',borderRadius:9}}>{message}</p>}
   {loading?<p role="status">Consultando empresas y cifras del mes…</p>:<>
    <section style={card}>
     <h2 style={{fontSize:19,marginTop:0}}>Empresas registradas y sus resultados</h2>
     <div style={{overflowX:'auto'}}>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:13,textAlign:'left'}}>
       <thead><tr>{['Empresa','Tipo','Plan orientativo','Facturado','Cobrado','Resultado atribuible'].map(h=><th key={h} style={{padding:'10px 9px',borderBottom:'1px solid #dce3ef'}}>{h}</th>)}</tr></thead>
       <tbody>{options.map(o=>{
        const r=calculate(o);
        return <tr key={keyOf(o)} style={{background:selected===keyOf(o)?'#f0f5fc':'transparent',cursor:'pointer'}} onClick={()=>setSelected(keyOf(o))}>
         <td style={{padding:10,borderBottom:'1px solid #edf0f5'}}><strong>{o.companyName}</strong>{changed[keyOf(o)]&&<span style={{color:'#976000'}}> · sin guardar</span>}</td>
         <td>{o.companySource==='operational'?'Operativa (referencia)':'Staging / demo'}</td>
         <td>{o.suggestedPlan?.toUpperCase()||'Sin asignar'}</td>
         <td>{r.billed===null?'Pendiente':format(r.billed)}</td>
         <td>{r.received===null?'Pendiente':format(r.received)}</td>
         <td>{r.result===null?'No calculable':format(r.result)}</td>
        </tr>;
       })}</tbody>
      </table>
     </div>
     <p style={{fontSize:12,color:'#67768b'}}>Los valores vacíos no se consideran cero. El resultado por empresa solo se calcula con ingresos facturados y todos los costos informados, incluidos los compartidos.</p>
    </section>
    <section style={{...card,marginTop:17}}>
     <h2 style={{fontSize:19,marginTop:0}}>Registrar cifras del cliente</h2>
     <label style={{display:'grid',gap:6,maxWidth:520,fontSize:13,fontWeight:700,marginBottom:16}}>
      Empresa seleccionada
      <select style={inputStyle} value={selected} onChange={e=>{setSelected(e.target.value);setMessage('');}}>
       {options.map(o=><option key={keyOf(o)} value={keyOf(o)}>{o.companyName} · {o.companySource==='operational'?'Operativa':'Staging'}</option>)}
      </select>
     </label>
     {active&&form&&<>
      <p style={{fontSize:13,color:'#536580'}}>Plan sugerido: <strong>{active.suggestedPlan?.toUpperCase()||'Sin plan'}</strong>. No es una suscripción ni un cobro activado.</p>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))',gap:15}}>
       {details.map(([field,label])=><label key={field} style={{display:'grid',gap:6,fontSize:13}}>{label}
        <input type="number" min={0} step=".01" style={inputStyle} placeholder="No registrado"
         value={form[field]} onChange={e=>edit({[field]:e.target.value})}/>
       </label>)}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:16,marginTop:18}}>
       <label style={{fontSize:13,display:'flex',gap:9,alignItems:'center'}}>
        <input type="checkbox" checked={form.includeInAllocation} onChange={e=>edit({includeInAllocation:e.target.checked})}/>
        Incluir en reparto informativo de costos compartidos
       </label>
       <label style={{display:'grid',gap:6,fontSize:13}}>Peso del reparto (1 = parte igual)
        <input type="number" min={0.001} max={1000} step=".001" style={inputStyle}
         value={form.allocationWeight} onChange={e=>edit({allocationWeight:Math.max(0.001,Math.min(1000,Number(e.target.value)||1))})}/>
       </label>
      </div>
      <label style={{display:'grid',gap:6,marginTop:17,fontSize:13}}>
       Notas y referencias de soportes
       <textarea rows={3} maxLength={1000} style={inputStyle} value={form.evidenceNote}
        onChange={e=>edit({evidenceNote:e.target.value})}
        placeholder="Ej. factura cobrada y fecha; cálculo de tokens comprobado; horas de soporte. Sin contraseñas ni tarjetas."/>
      </label>
      <button type="button" disabled={saving} onClick={()=>void save()}
       style={{marginTop:15,padding:'12px 18px',background:'#172235',color:'white',border:0,borderRadius:9,fontWeight:800,cursor:'pointer'}}>
       {saving?'Guardando…':'Guardar información de esta empresa'}
      </button>
      <div style={{marginTop:17,padding:16,background:'#f6f9fd',borderRadius:10,fontSize:13,lineHeight:1.8}}>
       <strong>Resultado del cliente:</strong>
       <p>Facturado: {activeResult?.billed===null?'Pendiente':format(activeResult?.billed??0)} · Cobrado: {activeResult?.received===null?'Pendiente':format(activeResult?.received??0)}</p>
       <p>Costos directos: {activeResult?.directCost===null?'Pendientes':format(activeResult?.directCost??0)} · Compartidos asignados: {activeResult?.allocated===null?'Pendientes':format(activeResult?.allocated??0)}</p>
       <p><strong>Resultado calculado:</strong> {activeResult?.result===null?'No calculable todavía':format(activeResult?.result??0)}</p>
      </div>
     </>}
    </section>
    <section style={{...card,marginTop:17}}>
     <h2 style={{fontSize:19,marginTop:0}}>Reparto de infraestructura y gastos compartidos</h2>
     {sharedCosts===null?<p style={{fontSize:13,color:'#896012'}}>Faltan importes del mes en el control financiero general. No se puede repartir un gasto desconocido. Ve al <Link href="/admin/simulador-financiero">registro mensual de costos</Link> e ingresa los importes comprobados.</p>
      :<p style={{fontSize:14}}>Gastos comunes informados del mes: <strong>{format(sharedCosts)}</strong> · Total de pesos de reparto: {allocation.totalWeight.toLocaleString('es-CO')}.</p>}
     <p style={{fontSize:13,color:'#66758a'}}>El reparto es una convención contable basada en los pesos elegidos. No mide infraestructura consumida realmente por cada empresa. El OpenAI global no se distribuye automáticamente: registra su costo directo por cliente cuando exista medición verificable.</p>
     <p style={{fontSize:13,color:'#66758a'}}>Total de cobros con algún registro: {format(receipts)}. {allReceiptsKnown?'Todas las empresas mostradas tienen un importe registrado.':'Es una suma parcial; faltan cobros de algunas empresas.'}</p>
    </section>
   </>}
  </main>
 </div>;
}
