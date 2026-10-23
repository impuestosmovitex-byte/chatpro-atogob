'use client';
import {useState} from 'react';
import Link from 'next/link';
import {PlatformSidebar} from '../../components/PlatformSidebar';

type Usage={ok:boolean;companyId:string;periodStart:string;records:number;truncated:boolean;inputTokens:number;outputTokens:number;cachedInputTokens:number;knownEstimatedCostUsd:number;recordsWithoutCost:number;pricedFromConfiguredRatesUsd?:number;recordsMissingRates?:number;rateConfigurationAvailable?:boolean;coverage:string};
export default function AiUsageAdmin(){
 const [companyId,setCompanyId]=useState('');
 const [loading,setLoading]=useState(false);
 const [data,setData]=useState<Usage|null>(null);
 const [error,setError]=useState('');
 async function search(){
  setLoading(true);setError('');setData(null);
  try{
   const response=await fetch('/api/platform-admin/ai-usage?companyId='+encodeURIComponent(companyId.trim()),{cache:'no-store'});
   const result=await response.json() as Usage&{error?:string};
   if(!response.ok||!result.ok)throw new Error(result.error||'No disponible');
   setData(result);
  }catch(e){setError(e instanceof Error?e.message:'Error de consulta');}
  finally{setLoading(false);}
 }
 return <div style={{background:'#f6f7fa',minHeight:'100vh',color:'#172235'}}>
  <PlatformSidebar/>
  <main style={{marginLeft:176,padding:'36px 42px',maxWidth:1080}}>
   <p style={{fontSize:12,fontWeight:800,color:'#866408'}}>SUPERADMIN · MW1 STAGING</p>
   <h1 style={{fontSize:32,margin:'10px 0'}}>Consumo de IA por empresa</h1>
   <p>Reporte interno de llamadas instrumentadas. Todavía NO refleja la totalidad de OpenAI ni permite cobrar o limitar consumo.</p>
   <p><Link href="/admin/empresas">Volver a empresas</Link> · <Link href="/admin/planes">Planes comerciales</Link></p>
   <div style={{background:'white',padding:22,borderRadius:14,marginTop:22,display:'grid',gap:12}}>
    <label htmlFor="companyId">Identificador interno de la empresa</label>
    <input id="companyId" value={companyId} onChange={e=>setCompanyId(e.target.value)} placeholder="UUID de empresa" style={{padding:12,border:'1px solid #ccd2dc',borderRadius:8}}/>
    <button type="button" disabled={loading} onClick={()=>void search()} style={{padding:12,background:'#172235',color:'#fff',border:0,borderRadius:8,cursor:'pointer'}}>{loading?'Consultando…':'Consultar consumo registrado'}</button>
    {error&&<p role="alert" style={{color:'#b42318'}}>{error}</p>}
    {data&&<div style={{display:'grid',gap:12}}>
     <h2 style={{fontSize:21}}>Eventos instrumentados desde {new Date(data.periodStart).toLocaleDateString('es-CO')}</h2>
     <p>Solicitudes registradas: <strong>{data.records.toLocaleString('es-CO')}</strong></p>
     <p>Tokens de entrada: <strong>{data.inputTokens.toLocaleString('es-CO')}</strong></p>
     <p>Tokens de salida: <strong>{data.outputTokens.toLocaleString('es-CO')}</strong></p>
     <p>Tokens en caché: <strong>{data.cachedInputTokens.toLocaleString('es-CO')}</strong></p>
     <p>Costo estimado conocido (USD): <strong>{data.knownEstimatedCostUsd.toFixed(4)}</strong></p>
     <p>Costo calculado con tarifas configuradas (USD): <strong>{data.pricedFromConfiguredRatesUsd?.toFixed(4)??'Pendiente'}</strong></p>
     <p>Eventos sin tarifa verificable: <strong>{data.recordsMissingRates??'Pendiente'}</strong></p>
     <p>Eventos sin costo directo registrado: <strong>{data.recordsWithoutCost}</strong></p>
     <p style={{color:'#976100'}}>Advertencia: {data.records===0?'sin mediciones registradas no significa consumo cero.':'datos parciales; no usar para facturación.'}{data.truncated?' Se alcanzó el límite de filas; consulta incompleta.':''}</p>
    </div>}
   </div>
  </main>
 </div>;
}
