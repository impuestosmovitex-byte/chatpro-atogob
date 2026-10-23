'use client';
import {useMemo,useState} from 'react';
import Link from 'next/link';
import {AppSidebar} from '../../components/AppSidebar';
import {MW1_COMMERCIAL_PROPOSAL} from '../../lib/mw1-commercial-proposal';

const cop=(value:number)=>new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(value);
const inputStyle={width:'100%',padding:'9px 11px',border:'1px solid #d6dce7',borderRadius:9,background:'#fff'};
const safe=(value:string)=>Math.max(0,Math.min(1000000000,Number(value)||0));
export default function SimuladorFinancieroMW1(){
 const [counts,setCounts]=useState([2,3,1]);
 const [prices,setPrices]=useState<number[]>(MW1_COMMERCIAL_PROPOSAL.map(p=>p.price));
 const [railway,setRailway]=useState(25000);
 const [supabase,setSupabase]=useState(110000);
 const [openAiPerCompany,setOpenAiPerCompany]=useState(30000);
 const [otherFixed,setOtherFixed]=useState(0);
 const [supportPerCompany,setSupportPerCompany]=useState(0);
 const [fxRate,setFxRate]=useState(4000);
 const [usdOpenAi,setUsdOpenAi]=useState(false);
 const result=useMemo(()=>{
  const clients=counts.reduce((n,v)=>n+v,0);
  const income=counts.reduce((n,v,i)=>n+v*prices[i],0);
  const fixed=railway+supabase+otherFixed;
  const aiUnit=usdOpenAi?openAiPerCompany*fxRate:openAiPerCompany;
  const variable=clients*(aiUnit+supportPerCompany);
  const costs=fixed+variable;
  const contribution=income-costs;
  return {clients,income,fixed,variable,costs,contribution,margin:income>0?contribution/income*100:0,unitCost:clients?costs/clients:0};
 },[counts,prices,railway,supabase,otherFixed,openAiPerCompany,supportPerCompany,fxRate,usdOpenAi]);
 return <div style={{minHeight:'100vh',background:'#f6f7fa',color:'#172235'}}>
  <AppSidebar/>
  <main style={{marginLeft:160,padding:'36px 42px 70px',maxWidth:1250}}>
   <p style={{fontSize:12,fontWeight:850,color:'#967000'}}>SUPERADMIN · MW1 · SIMULACIÓN</p>
   <h1 style={{fontSize:32,margin:'9px 0'}}>Simulador financiero</h1>
   <p style={{color:'#657187',lineHeight:1.6}}>Ajusta empresas, tarifas, infraestructura y consumo estimado de IA para evaluar la contribución mensual del SaaS. No consulta facturas reales, no modifica precios públicos y no activa cobros.</p>
   <p><Link href="/admin/planes">Planes</Link> · <Link href="/admin/consumo-ia">Consumo IA</Link> · <Link href="/admin/tarifas-ia">Tarifas IA</Link></p>
   <section style={{marginTop:24,background:'#fff',padding:22,borderRadius:16,border:'1px solid #e3e7ee'}}>
    <h2 style={{fontSize:20,marginBottom:16}}>Empresas y mensualidades</h2>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:16}}>
    {MW1_COMMERCIAL_PROPOSAL.map((p,i)=><div key={p.key} style={{display:'grid',gap:9,padding:15,borderRadius:12,background:'#fafbfe'}}>
     <strong>{p.name}</strong>
     <label>Empresas<input type="number" min={0} max={100000} value={counts[i]} style={inputStyle} onChange={e=>setCounts(old=>old.map((n,j)=>j===i?Math.min(100000,safe(e.target.value)):n))}/></label>
     <label>Precio COP/mes<input type="number" min={0} max={100000000} value={prices[i]} style={inputStyle} onChange={e=>setPrices(old=>old.map((n,j)=>j===i?Math.min(100000000,safe(e.target.value)):n))}/></label>
    </div>)}
    </div>
   </section>
   <section style={{marginTop:18,background:'#fff',padding:22,borderRadius:16,border:'1px solid #e3e7ee'}}>
    <h2 style={{fontSize:20,marginBottom:16}}>Costos mensuales proyectados</h2>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:16}}>
    {[['Railway (COP)',railway,setRailway],['Supabase (COP)',supabase,setSupabase],['Otros fijos (COP)',otherFixed,setOtherFixed],['Soporte por empresa (COP)',supportPerCompany,setSupportPerCompany]] .map(([label,value,setter])=><label key={label as string} style={{display:'grid',gap:7}}>{label as string}<input type="number" min={0} max={1000000000} style={inputStyle} value={value as number} onChange={e=>(setter as (v:number)=>void)(safe(e.target.value))}/></label>)}
    <label style={{display:'grid',gap:7}}>IA estimada por empresa <input type="number" min={0} step="any" style={inputStyle} value={openAiPerCompany} onChange={e=>setOpenAiPerCompany(safe(e.target.value))}/></label>
    <label style={{display:'grid',gap:7}}>Moneda del costo IA<select value={usdOpenAi?'USD':'COP'} style={inputStyle} onChange={e=>setUsdOpenAi(e.target.value==='USD')}><option value="COP">COP</option><option value="USD">USD</option></select></label>
    {usdOpenAi&&<label style={{display:'grid',gap:7}}>COP por USD, supuesto editable<input type="number" min={0} value={fxRate} style={inputStyle} onChange={e=>setFxRate(safe(e.target.value))}/></label>}
    </div>
   </section>
   <section style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:12,marginTop:20}}>
    {[['Empresas',String(result.clients)],['Ingresos',cop(result.income)],['Costos proyectados',cop(result.costs)],['Contribución',cop(result.contribution)],['Margen',result.margin.toFixed(1)+'%'],['Costo por empresa',cop(result.unitCost)]].map(([label,value])=><div key={label} style={{padding:17,background:'white',border:'1px solid #e2e6ee',borderRadius:12}}><p style={{color:'#657187',fontSize:13}}>{label}</p><strong style={{fontSize:23}}>{value}</strong></div>)}
   </section>
   <p style={{marginTop:20,color:'#657187',lineHeight:1.6,fontSize:13}}>Contribución = ingresos menos costos simulados de infraestructura, IA y soporte. No es utilidad neta: faltan impuestos, marketing, pagos, desarrollo, nómina y otros gastos. El costo de infraestructura podría aumentar al crecer el número de empresas; este modelo no lo predice automáticamente. Valores iniciales ilustrativos y editables, no facturas verificadas.</p>
  </main>
 </div>;
}
