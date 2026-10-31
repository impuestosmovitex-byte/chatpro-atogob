'use client';
import {useEffect,useState,type FormEvent} from 'react';
import Link from 'next/link';
import {PlatformSidebar} from '../../components/PlatformSidebar';
type Rate={model:string;input_usd_per_million:number;cached_input_usd_per_million:number;output_usd_per_million:number;effective_from:string};
export default function AiRatesPage(){
 const [rates,setRates]=useState<Rate[]>([]),[model,setModel]=useState(''),[input,setInput]=useState(''),[cached,setCached]=useState(''),[output,setOutput]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 async function reload(){
  const response=await fetch('/api/platform-admin/ai-model-rates',{cache:'no-store'});
  const result=await response.json() as {ok?:boolean;rates?:Rate[];error?:string};
  if(!response.ok||!result.ok)throw new Error(result.error||'No autorizado');
  setRates(result.rates??[]);
 }
 useEffect(()=>{void reload().catch(e=>setError(e instanceof Error?e.message:'No se pudieron cargar tarifas'));},[]);
 async function save(e:FormEvent<HTMLFormElement>){
  e.preventDefault();setBusy(true);setError('');setNotice('');
  try{
   const values=[input,cached,output];
   if(values.some(v=>v.trim()===''||!Number.isFinite(Number(v))||Number(v)<0))throw new Error('Completa todas las tarifas válidas.');
   const response=await fetch('/api/platform-admin/ai-model-rates',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:model.trim(),input:Number(input),cached:Number(cached),output:Number(output)})});
   const result=await response.json() as {ok?:boolean;error?:string};
   if(!response.ok||!result.ok)throw new Error(result.error||'No guardado');
   await reload();setNotice('Tarifa guardada en staging. No modifica facturación.');
  }catch(err){setError(err instanceof Error?err.message:'Error');}finally{setBusy(false);}
 }
 const field={padding:11,borderRadius:9,border:'1px solid #ccd2df',width:'100%'};
 return <div style={{background:'#f6f7fa',minHeight:'100vh',color:'#172235'}}><PlatformSidebar/>
  <main style={{marginLeft:176,padding:'34px 40px',maxWidth:1080}}>
   <p style={{fontSize:12,fontWeight:800,color:'#987400'}}>SUPERADMIN · MW1 STAGING</p>
   <h1 style={{fontSize:30}}>Tarifas de modelos de IA</h1>
   <p style={{color:'#657187'}}>Solo tarifas verificadas, expresadas en USD por millón de tokens. Sin tarifas cargadas, el costo figura pendiente.</p>
   <p><Link href="/admin/consumo-ia">← Consumo de IA</Link></p>
   <form onSubmit={e=>void save(e)} style={{padding:24,background:'#fff',borderRadius:14,margin:'22px 0',display:'grid',gap:15}}>
    <label>Modelo exacto de OpenAI <input required maxLength={120} style={field} value={model} onChange={e=>setModel(e.target.value)} placeholder="ID exacto del modelo"/></label>
    <label>USD / 1M tokens de entrada <input required type="number" min={0} step="any" style={field} value={input} onChange={e=>setInput(e.target.value)}/></label>
    <label>USD / 1M tokens de entrada en caché <input required type="number" min={0} step="any" style={field} value={cached} onChange={e=>setCached(e.target.value)}/></label>
    <label>USD / 1M tokens de salida <input required type="number" min={0} step="any" style={field} value={output} onChange={e=>setOutput(e.target.value)}/></label>
    <button disabled={busy} style={{padding:13,border:0,borderRadius:9,background:'#172235',color:'white',fontWeight:800}}>{busy?'Guardando…':'Guardar tarifa privada'}</button>
    {error&&<p role="alert" style={{color:'#b42318'}}>{error}</p>}{notice&&<p role="status">{notice}</p>}
   </form>
   <h2>Tarifas configuradas</h2>
   {rates.length===0?<p>No hay tarifas registradas todavía.</p>:<div style={{overflowX:'auto'}}><table style={{width:'100%',background:'white',borderCollapse:'collapse'}}><thead><tr><th>Modelo</th><th>Entrada</th><th>Caché</th><th>Salida</th></tr></thead><tbody>{rates.map(r=><tr key={r.model}>{[r.model,r.input_usd_per_million,r.cached_input_usd_per_million,r.output_usd_per_million].map((v,i)=><td key={i} style={{padding:12,borderBottom:'1px solid #eee'}}>{v}</td>)}</tr>)}</tbody></table></div>}
  </main>
 </div>;
}
