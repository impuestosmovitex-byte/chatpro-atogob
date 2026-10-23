'use client';
import {useEffect,useMemo,useState} from 'react';
import Link from 'next/link';
import {PlatformSidebar} from '../../components/PlatformSidebar';
import {MW1_COMMERCIAL_PROPOSAL} from '../../lib/mw1-commercial-proposal';

type Scenario={
 counts:number[];prices:number[];railway:number;supabase:number;otherFixed:number;
 supportPerCompany:number;openAiPerCompany:number;fxRate:number;usdOpenAi:boolean;
 technicianMonthly:number;administrationMonthly:number;marketingMonthly:number;
 toolsMonthly:number;newCustomers:number;onboardingCostPerCustomer:number;
 onboardingFeePerCustomer:number;paymentProcessingPercent:number;targetMarginPercent:number;
};
const initial:Scenario={
 counts:[2,3,1],prices:MW1_COMMERCIAL_PROPOSAL.map(p=>p.price),
 railway:25000,supabase:110000,otherFixed:0,
 supportPerCompany:0,openAiPerCompany:30000,fxRate:4000,usdOpenAi:false,
 technicianMonthly:0,administrationMonthly:0,marketingMonthly:0,toolsMonthly:0,
 newCustomers:0,onboardingCostPerCustomer:0,onboardingFeePerCustomer:0,
 paymentProcessingPercent:0,targetMarginPercent:25,
};
const fields=[
 ['receivedCop','Ingresos realmente recibidos'],
 ['railwayCop','Railway pagado'],
 ['supabaseCop','Supabase pagado'],
 ['openaiCop','OpenAI pagado'],
 ['technicalSupportCop','Soporte técnico pagado'],
 ['personnelCop','Personal y administración'],
 ['marketingCop','Publicidad pagada'],
 ['otherCop','Otros gastos pagados'],
] as const;
type ActualKey=typeof fields[number][0];
type ActualForm=Record<ActualKey,string>;
const emptyActual=():ActualForm=>({
 receivedCop:'',railwayCop:'',supabaseCop:'',openaiCop:'',
 technicalSupportCop:'',personnelCop:'',marketingCop:'',otherCop:'',
});
const cop=(n:number)=>new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(n);
const inputStyle={width:'100%',padding:'10px 11px',border:'1px solid #d6dce7',borderRadius:9,background:'#fff'};
const card={background:'#fff',border:'1px solid #e3e7ee',padding:22,borderRadius:16,marginTop:18};
const safe=(s:string,max=1000000000)=>Math.max(0,Math.min(max,Number(s)||0));
function currentMonth(){return new Date().toLocaleDateString('en-CA',{timeZone:'America/Bogota',year:'numeric',month:'2-digit'}).slice(0,7)+'-01';}

export default function SimuladorFinancieroMW1(){
 const [scenario,setScenario]=useState<Scenario>(initial);
 const [periodMonth,setPeriodMonth]=useState(currentMonth);
 const [actual,setActual]=useState<ActualForm>(emptyActual);
 const [evidenceNote,setEvidenceNote]=useState('');
 const [savedScenario,setSavedScenario]=useState(false);
 const [scenarioUpdatedAt,setScenarioUpdatedAt]=useState<string|null>(null);
 const [actualUpdatedAt,setActualUpdatedAt]=useState<string|null>(null);
 const [loading,setLoading]=useState(true);
 const [saving,setSaving]=useState<'scenario'|'actual'|null>(null);
 const [feedback,setFeedback]=useState('');
 const [loadError,setLoadError]=useState('');
 const [priceNotice,setPriceNotice]=useState('');
 const [loadingPublished,setLoadingPublished]=useState(false);

 function update<K extends keyof Scenario>(key:K,value:Scenario[K]){
  setScenario(prev=>({...prev,[key]:value}));
 }
 function changePlan(key:'counts'|'prices',index:number,value:number){
  setScenario(prev=>({...prev,[key]:prev[key].map((n,i)=>i===index?value:n)}));
 }
 useEffect(()=>{
  let active=true;
  setLoading(true);setLoadError('');
  void (async()=>{
   try{
    const response=await fetch('/api/platform-admin/finance?month='+encodeURIComponent(periodMonth),{cache:'no-store'});
    const data=await response.json() as {ok?:boolean;error?:string;scenario?:Scenario|null;
      scenarioUpdatedAt?:string|null;actual?:Record<string,unknown>|null};
    if(!response.ok||!data.ok)throw new Error(data.error||'No se pudo cargar la información financiera.');
    if(!active)return;
    if(data.scenario){setScenario(data.scenario);setSavedScenario(true);}
    else{setScenario(initial);setSavedScenario(false);}
    setScenarioUpdatedAt(data.scenarioUpdatedAt||null);
    if(data.actual){
     const values=emptyActual();
     const mappings:Record<ActualKey,string>={
      receivedCop:'received_cop',railwayCop:'railway_cop',supabaseCop:'supabase_cop',
      openaiCop:'openai_cop',technicalSupportCop:'technical_support_cop',
      personnelCop:'personnel_cop',marketingCop:'marketing_cop',otherCop:'other_cop',
     };
     for(const [key] of fields){
      const v=data.actual[mappings[key]];
      values[key]=v===null||v===undefined?'':String(v);
     }
     setActual(values);
     setEvidenceNote(typeof data.actual.evidence_note==='string'?data.actual.evidence_note:'');
     setActualUpdatedAt(typeof data.actual.updated_at==='string'?data.actual.updated_at:null);
    }else{
     setActual(emptyActual());setEvidenceNote('');setActualUpdatedAt(null);
    }
   }catch(e){if(active)setLoadError(e instanceof Error?e.message:'Error de consulta.');}
   finally{if(active)setLoading(false);}
  })();
  return()=>{active=false;};
 },[periodMonth]);
 async function save(kind:'scenario'|'actual'){
  setSaving(kind);setFeedback('');
  try{
   const payload=kind==='scenario'?scenario:{
    periodMonth,evidenceNote,
    ...Object.fromEntries(fields.map(([key])=>[key,actual[key].trim()===''?null:Number(actual[key])])),
   };
   const response=await fetch('/api/platform-admin/finance?kind='+kind,{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),
   });
   const data=await response.json() as {ok?:boolean;error?:string;message?:string};
   if(!response.ok||!data.ok)throw new Error(data.error||'No fue posible guardar.');
   setFeedback(data.message||'Guardado.');
   if(kind==='scenario'){setSavedScenario(true);setScenarioUpdatedAt(new Date().toISOString());}
   else setActualUpdatedAt(new Date().toISOString());
  }catch(e){setFeedback(e instanceof Error?e.message:'No fue posible guardar.');}
  finally{setSaving(null);}
 }
 async function importPublishedPrices(){
  setLoadingPublished(true);setPriceNotice('');
  try{
   const response=await fetch('/api/platform-admin/plan-published',{cache:'no-store'});
   const data=await response.json() as {ok?:boolean;error?:string;plans?:Array<{plan_key:string;price_cop:number}>};
   if(!response.ok||!data.ok||!Array.isArray(data.plans))throw new Error(data.error||'No se pudieron consultar las tarifas.');
   const published=new Map(data.plans.map(p=>[p.plan_key,p.price_cop]));
   if(!published.size){setPriceNotice('No hay planes publicados. Se conservan los precios actuales del escenario.');return;}
   setScenario(prev=>({...prev,prices:MW1_COMMERCIAL_PROPOSAL.map((plan,i)=>{
    const found=published.get(plan.legacyKey);
    return typeof found==='number'&&Number.isFinite(found)&&found>0?found:prev.prices[i];
   })}));
   setPriceNotice('Tarifas publicadas importadas para simulación. Guarda el escenario si deseas conservarlas.');
  }catch(e){setPriceNotice(e instanceof Error?e.message:'No fue posible importar tarifas.');}
  finally{setLoadingPublished(false);}
 }
 const calc=useMemo(()=>{
  const s=scenario;
  const clients=s.counts.reduce((a,b)=>a+b,0);
  const recurring=s.counts.reduce((n,v,i)=>n+v*s.prices[i],0);
  const setupRevenue=s.newCustomers*s.onboardingFeePerCustomer;
  const income=recurring+setupRevenue;
  const fixed=s.railway+s.supabase+s.otherFixed+s.technicianMonthly+
    s.administrationMonthly+s.marketingMonthly+s.toolsMonthly;
  const aiPerCompany=s.openAiPerCompany*(s.usdOpenAi?s.fxRate:1);
  const perCompany=aiPerCompany+s.supportPerCompany;
  const variable=clients*perCompany;
  const onboardingCost=s.newCustomers*s.onboardingCostPerCustomer;
  const paymentCost=income*s.paymentProcessingPercent/100;
  const costs=fixed+variable+onboardingCost+paymentCost;
  const profit=income-costs;
  const averagePrice=clients?recurring/clients:0;
  const averageContribution=averagePrice*(1-s.paymentProcessingPercent/100)-perCompany;
  const breakEven=averageContribution>0?Math.ceil(fixed/averageContribution):null;
  const denominator=1-s.targetMarginPercent/100-s.paymentProcessingPercent/100;
  const revenueTarget=denominator>0?(fixed+variable+onboardingCost)/denominator:null;
  const fixedPerCompany=clients?fixed/clients:0;
  return {clients,recurring,setupRevenue,income,fixed,aiPerCompany,perCompany,variable,
   onboardingCost,paymentCost,costs,profit,averagePrice,breakEven,revenueTarget,fixedPerCompany,
   margin:income?profit/income*100:0};
 },[scenario]);
 const actualKnown=fields.filter(([key])=>actual[key].trim()!=='').length;
 const allActualsKnown=actualKnown===fields.length;
 const actualRevenue=actual.receivedCop.trim()===''?null:Number(actual.receivedCop);
 const actualTotalExpenses=fields.filter(([key])=>key!=='receivedCop').reduce((sum,[key])=>{
  return sum+(actual[key].trim()===''?0:Number(actual[key]));
 },0);
 const actualResult=allActualsKnown&&actualRevenue!==null?actualRevenue-actualTotalExpenses:null;

 const monthlyCostFields=[
  ['railway','Railway / mes'],['supabase','Supabase / mes'],['technicianMonthly','Técnicos y mantenimiento / mes'],
  ['administrationMonthly','Administración y personal / mes'],['marketingMonthly','Publicidad / mes'],
  ['toolsMonthly','Software y herramientas / mes'],['otherFixed','Otros gastos fijos / mes'],
  ['supportPerCompany','Soporte por empresa / mes'],
  ['onboardingCostPerCustomer','Costo de configuración por cliente nuevo'],
  ['onboardingFeePerCustomer','Ingreso por configuración por cliente nuevo'],
 ] as const;
 return <div style={{minHeight:'100vh',background:'#f6f7fa',color:'#172235'}}>
  <PlatformSidebar/>
  <main style={{marginLeft:176,padding:'34px 34px 70px',maxWidth:1340}}>
   <p style={{fontSize:12,fontWeight:900,letterSpacing:'.09em',color:'#926d08'}}>SUPERADMIN · MW1 · CONTROL FINANCIERO</p>
   <h1 style={{fontSize:30,margin:'10px 0'}}>Rentabilidad y control de gastos</h1>
   <p style={{color:'#56677d',lineHeight:1.6,maxWidth:930}}>
    Compara ingresos previstos, costos de tecnología, IA, soporte y personal. Separa las proyecciones
    de los pagos reales. Esta herramienta es privada, solo de staging: no factura clientes ni cambia sus planes.
   </p>
   <p><Link href="/admin/empresas">Empresas</Link> · <Link href="/admin/planes">Tarifas comerciales</Link> · <Link href="/admin/consumo-ia">Medición IA</Link></p>
   {loadError&&<p role="alert" style={{background:'#fff4f2',color:'#962c27',padding:14,borderRadius:10}}>{loadError}</p>}
   {feedback&&<p role="status" style={{padding:14,borderRadius:10,background:'#ecf3fd',color:'#234668'}}>{feedback}</p>}
   <section style={card}>
    <h2 style={{fontSize:21,marginTop:0}}>1. Escenario de negocio</h2>
    <p style={{fontSize:13,color:'#657187'}}>Este escenario representa valores supuestos, no ingresos cobrados.
     {savedScenario?' Existe un escenario guardado.':' Se muestra un ejemplo ilustrativo que aún no has guardado.'}
     {scenarioUpdatedAt?' Último guardado: '+new Date(scenarioUpdatedAt).toLocaleString('es-CO'):''}
    </p>
    <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:16}}>
     <button type="button" onClick={()=>void importPublishedPrices()} disabled={loadingPublished||loading}
      style={{padding:'10px 15px',border:'1px solid #a8b8d0',background:'#fff',borderRadius:9,cursor:'pointer'}}>
       {loadingPublished?'Consultando…':'Cargar precios publicados'}
     </button>
     <button type="button" onClick={()=>void save('scenario')} disabled={loading||saving!==null}
      style={{padding:'10px 15px',border:0,background:'#172235',color:'#fff',fontWeight:800,borderRadius:9,cursor:'pointer'}}>
      {saving==='scenario'?'Guardando…':'Guardar escenario privado'}
     </button>
    </div>
    {priceNotice&&<p role="status" style={{fontSize:13,color:'#525f73'}}>{priceNotice}</p>}
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:15}}>
     {MW1_COMMERCIAL_PROPOSAL.map((plan,i)=><div key={plan.key} style={{display:'grid',gap:9,background:'#f6f8fc',padding:15,borderRadius:11}}>
      <strong>{plan.name}</strong>
      <label style={{display:'grid',gap:5,fontSize:13}}>Empresas estimadas
       <input type="number" min={0} max={100000} style={inputStyle} value={scenario.counts[i]}
        onChange={e=>changePlan('counts',i,Math.floor(safe(e.target.value,100000)))}/></label>
      <label style={{display:'grid',gap:5,fontSize:13}}>Tarifa mensual COP
       <input type="number" min={0} max={100000000} style={inputStyle} value={scenario.prices[i]}
        onChange={e=>changePlan('prices',i,Math.floor(safe(e.target.value,100000000)))}/></label>
     </div>)}
    </div>
   </section>
   <section style={card}>
    <h2 style={{fontSize:21,marginTop:0}}>2. Todos los gastos del negocio</h2>
    <p style={{color:'#657187',fontSize:13}}>Escribe el gasto mensual estimado de cada categoría. Un cero dentro del escenario no prueba que ese gasto real sea cero.</p>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:15}}>
     {monthlyCostFields.map(([field,label])=><label key={field} style={{display:'grid',gap:6,fontSize:13}}>
      {label}<input style={inputStyle} type="number" min={0} max={1000000000} value={scenario[field]}
       onChange={e=>update(field,safe(e.target.value))}/></label>)}
     <label style={{display:'grid',gap:6,fontSize:13}}>IA estimada por empresa
      <input type="number" style={inputStyle} min={0} value={scenario.openAiPerCompany} onChange={e=>update('openAiPerCompany',safe(e.target.value))}/></label>
     <label style={{display:'grid',gap:6,fontSize:13}}>Moneda de IA
      <select style={inputStyle} value={scenario.usdOpenAi?'USD':'COP'} onChange={e=>update('usdOpenAi',e.target.value==='USD')}>
       <option value="COP">COP</option><option value="USD">USD</option>
      </select></label>
     {scenario.usdOpenAi&&<label style={{display:'grid',gap:6,fontSize:13}}>Cambio supuesto (COP por USD)
      <input type="number" min={100} max={100000} style={inputStyle} value={scenario.fxRate}
       onChange={e=>update('fxRate',safe(e.target.value,100000))}/></label>}
     <label style={{display:'grid',gap:6,fontSize:13}}>Clientes nuevos este mes
      <input type="number" min={0} max={100000} style={inputStyle} value={scenario.newCustomers}
       onChange={e=>update('newCustomers',Math.floor(safe(e.target.value,100000)))}/></label>
     <label style={{display:'grid',gap:6,fontSize:13}}>Comisiones de pago (%)
      <input type="number" min={0} max={30} step=".1" style={inputStyle} value={scenario.paymentProcessingPercent}
       onChange={e=>update('paymentProcessingPercent',safe(e.target.value,30))}/></label>
     <label style={{display:'grid',gap:6,fontSize:13}}>Margen objetivo (%)
      <input type="number" min={0} max={90} step="1" style={inputStyle} value={scenario.targetMarginPercent}
       onChange={e=>update('targetMarginPercent',safe(e.target.value,90))}/></label>
    </div>
   </section>
   <section style={card}>
    <h2 style={{fontSize:21,marginTop:0}}>3. Resultado proyectado</h2>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(175px,1fr))',gap:12}}>
     {[
      ['Empresas',String(calc.clients)],['Ventas mensuales esperadas',cop(calc.recurring)],
      ['Ingresos por configuración',cop(calc.setupRevenue)],['Gastos proyectados',cop(calc.costs)],
      ['Resultado antes de impuestos',cop(calc.profit)],['Margen estimado',calc.margin.toFixed(1)+'%'],
      ['Costo total por empresa',calc.clients?cop(calc.costs/calc.clients):'Sin clientes'],
      ['Empresas para equilibrio',calc.breakEven===null?'No calculable':String(calc.breakEven)],
     ].map(([label,value])=><div key={label} style={{background:'#f7f9fc',padding:16,border:'1px solid #e2e6ee',borderRadius:11}}>
      <p style={{fontSize:12,color:'#63738a',margin:'0 0 8px'}}>{label}</p>
      <strong style={{fontSize:21}}>{value}</strong>
     </div>)}
    </div>
    <p style={{fontSize:14,marginTop:18}}><strong>Ingresos necesarios para el margen objetivo de {scenario.targetMarginPercent}%:</strong> {calc.revenueTarget===null?'No calculable':cop(calc.revenueTarget)} en este escenario.</p>
    <p style={{fontSize:13,color:'#657187'}}>Incluye {cop(calc.fixed)} de gastos fijos, {cop(calc.variable)} de costos variables, {cop(calc.onboardingCost)} de incorporación y {cop(calc.paymentCost)} en comisiones. El punto de equilibrio usa la mezcla y el ticket mensual promedio de estos planes, sin contar ingresos únicos por configuración.</p>
    <div style={{overflowX:'auto',marginTop:15}}>
     <table style={{width:'100%',borderCollapse:'collapse',fontSize:13,textAlign:'left'}}>
      <thead><tr><th style={{padding:10,borderBottom:'1px solid #d5dce7'}}>Plan</th><th>Clientes</th><th>Ventas recurrentes</th><th>Costo asignado estimado</th><th>Contribución estimada</th></tr></thead>
      <tbody>{MW1_COMMERCIAL_PROPOSAL.map((plan,i)=>{
       const n=scenario.counts[i],revenue=n*scenario.prices[i];
       const assigned=n*(calc.perCompany+calc.fixedPerCompany)+revenue*scenario.paymentProcessingPercent/100;
       return <tr key={plan.key}><td style={{padding:10,borderBottom:'1px solid #edf0f5'}}>{plan.name}</td><td>{n}</td><td>{cop(revenue)}</td><td>{cop(assigned)}</td><td>{cop(revenue-assigned)}</td></tr>;
      })}</tbody>
     </table>
    </div>
    <p style={{fontSize:12,color:'#657187'}}>Asignación por plan: infraestructura y otros fijos divididos por número de empresas; IA y soporte iguales por empresa; comisiones según ventas. Es una convención editable, no consumo individual realmente medido. El costo de incorporar clientes nuevos se muestra en el total general.</p>
   </section>
   <section style={card}>
    <h2 style={{fontSize:21,marginTop:0}}>4. Ingresos cobrados y gastos comprobados del mes</h2>
    <p style={{color:'#657187',fontSize:13}}>
     Esta sección es independiente del escenario. Deja vacías las cifras desconocidas: <strong>vacío no significa $0</strong>.
     Registra importes solo al comprobar facturas, extractos o pagos; no guardes precios de catálogo como ingresos recibidos.
    </p>
    <div style={{display:'flex',alignItems:'end',gap:14,flexWrap:'wrap',margin:'15px 0'}}>
     <label style={{display:'grid',gap:6,fontSize:13}}>Mes de seguimiento
      <input type="month" style={inputStyle} value={periodMonth.slice(0,7)}
       onChange={e=>{if(/^20[2-9][0-9]-(0[1-9]|1[0-2])$/.test(e.target.value))setPeriodMonth(e.target.value+'-01');}}/>
     </label>
     <span style={{fontSize:12,color:'#68778d'}}>{actualUpdatedAt?'Última edición: '+new Date(actualUpdatedAt).toLocaleString('es-CO'):'Sin registro mensual guardado'}</span>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:15}}>
     {fields.map(([key,label])=><label key={key} style={{display:'grid',gap:6,fontSize:13}}>
      {label} (COP)
      <input type="number" min={0} max={1000000000} step=".01" style={inputStyle}
       placeholder="No registrado" value={actual[key]}
       onChange={e=>setActual(old=>({...old,[key]:e.target.value}))}/>
     </label>)}
    </div>
    <label style={{display:'grid',gap:6,marginTop:16,fontSize:13}}>
     Referencias de soportes y observaciones
     <textarea rows={3} maxLength={1000} style={inputStyle} value={evidenceNote} onChange={e=>setEvidenceNote(e.target.value)} placeholder="Ej. Factura proveedor, fecha, conciliación; no incluyas contraseñas ni números de tarjeta."/>
    </label>
    <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap',marginTop:15}}>
     <button type="button" disabled={loading||saving!==null} onClick={()=>void save('actual')}
      style={{padding:'12px 17px',background:'#172235',color:'#fff',border:0,borderRadius:9,fontWeight:800,cursor:'pointer'}}>
      {saving==='actual'?'Guardando…':'Guardar registro mensual privado'}
     </button>
     <span style={{fontSize:13,color:'#586b83'}}>Campos informados: {actualKnown} de {fields.length}</span>
    </div>
    {actualResult===null?<p style={{color:'#88600c',fontSize:14,marginTop:17}}>Todavía no se puede calcular una utilidad real: faltan ingresos cobrados o gastos de este mes. No se interpretan los campos sin registro como gastos cero.</p>
    :<div style={{padding:14,background:'#eff6f1',borderRadius:10,marginTop:16}}>
      <strong>Resultado operativo manual de {periodMonth.slice(0,7)}: {cop(actualResult)}</strong>
      <p style={{fontSize:12}}>Ingresos reportados: {cop(actualRevenue||0)} · Gastos reportados: {cop(actualTotalExpenses)}. Los importes son declarados manualmente, no conciliados automáticamente. No incluyen necesariamente impuestos u otras obligaciones.</p>
     </div>}
   </section>
   <p style={{margin:'22px 0',fontSize:13,color:'#68778d',lineHeight:1.65}}>
    Los valores iniciales del simulador son ejemplos ilustrativos, no facturas de Railway, Supabase u OpenAI.
    El consumo de IA por empresa aún es parcial y no puede usarse para facturar. No se han conectado
    las cuentas de cobro ni se han cambiado los límites de ATOGOB o Emprende con Maogo.
   </p>
  </main>
 </div>;
}
