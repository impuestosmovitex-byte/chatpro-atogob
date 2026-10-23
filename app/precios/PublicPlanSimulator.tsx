'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {MW1_EXTRA_USER_PREVIEW_COP,MW1_EXTRA_CONNECTION_PREVIEW_COP} from '../lib/mw1-commercial-proposal';

type PublicOption={key:string;name:string;price:number;users:number;connections:number;extraUserCop:number;extraConnectionCop:number};
const pesos=(value:number)=>new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(value);
export default function PublicPlanSimulator({options,selectedPlanKey,onSelectPlan}:{options:PublicOption[];selectedPlanKey:string;onSelectPlan:(key:string)=>void}){
 const selected=Math.max(0,options.findIndex(x=>x.key===selectedPlanKey));
 const [users,setUsers]=useState<number>(3);
 const [connections,setConnections]=useState<number>(3);
 const plan=options[selected];
 useEffect(()=>{setUsers(plan.users);setConnections(plan.connections);},[plan.users,plan.connections,selectedPlanKey]);
 const extraUserPrice=plan.extraUserCop??MW1_EXTRA_USER_PREVIEW_COP;
 const extraConnectionPrice=plan.extraConnectionCop??MW1_EXTRA_CONNECTION_PREVIEW_COP;
 const extraUsers=Math.max(0,users-plan.users);
 const extraConnections=Math.max(0,connections-plan.connections);
 const total=plan.price+extraUsers*extraUserPrice+extraConnections*extraConnectionPrice;
 return <section style={{margin:'38px auto 0',maxWidth:900,padding:24,border:'1px solid #dce2eb',borderRadius:20,background:'#fff'}} aria-label="Simular suscripción MW1">
   <h3 style={{fontSize:25,marginBottom:8}}>Diseña tu plan</h3>
   <p style={{fontSize:14,color:'#586477',lineHeight:1.6,marginBottom:20}}>Calcula un valor orientativo según usuarios y conexiones. No genera cargos ni activa servicios.</p>
   <div style={{display:'flex',flexWrap:'wrap',gap:9,marginBottom:22}}>
    {options.map((p,i)=><button type="button" key={p.key} aria-pressed={selected===i} onClick={()=>{onSelectPlan(p.key);setUsers(p.users);setConnections(p.connections);}} style={{padding:'10px 18px',borderRadius:12,border:'1px solid #dce2eb',cursor:'pointer',fontWeight:800,background:'#f4bf00',color:'#172235',outline:selected===i?'2px solid #172235':'none',outlineOffset:2}}>{p.name}</button>)}
   </div>
   <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(250px,1fr))',gap:24,marginBottom:22}}>
    <label style={{display:'grid',gap:10,fontWeight:700}}>Usuarios: {users}<input aria-label="Cantidad de usuarios" type="range" min={plan.users} max={20} value={users} onChange={e=>setUsers(Number(e.target.value))}/><small style={{fontWeight:400,color:'#667085'}}>Incluidos: {plan.users}; adicional estimado: {pesos(extraUserPrice)}/mes</small></label>
    <label style={{display:'grid',gap:10,fontWeight:700}}>Conexiones: {connections}<input aria-label="Cantidad de conexiones" type="range" min={plan.connections} max={10} value={connections} onChange={e=>setConnections(Number(e.target.value))}/><small style={{fontWeight:400,color:'#667085'}}>Incluidas: {plan.connections}; adicional estimado: {pesos(extraConnectionPrice)}/mes</small></label>
   </div>
   <div style={{background:'#f5f7fa',borderRadius:14,padding:20,display:'flex',justifyContent:'space-between',alignItems:'center',gap:15,flexWrap:'wrap'}}>
    <div><small style={{color:'#667085'}}>Suscripción mensual orientativa</small><div style={{fontSize:30,fontWeight:900}}>{pesos(total)} <small style={{fontSize:13,fontWeight:500}}>/ mes</small></div></div>
    <Link href={`/prueba-gratis?plan=${plan.key}`} style={{background:'#f4bf00',borderRadius:12,padding:'13px 18px',fontWeight:800}}>Solicitar plan {plan.name}</Link>
   </div>
   <p style={{fontSize:12,color:'#667085',marginTop:14,lineHeight:1.6}}>Precios en evaluación. Los importes adicionales mostrados son orientativos y quedan sujetos a confirmación comercial. Los cargos Meta/WhatsApp se pagan aparte; disponibilidad y cupos de IA sujetos a confirmación.</p>
 </section>;
}
