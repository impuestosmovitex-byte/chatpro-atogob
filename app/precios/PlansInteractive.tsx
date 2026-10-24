'use client';
import Link from 'next/link';
import styles from '../components/marketing/marketing.module.css';

export type PlanCardOption={
 key:string;name:string;eyebrow:string;price:number;published:boolean;
 users:number;connections:number;featured:boolean;summary:string;
 highlights:readonly string[];included:readonly string[];conditional:readonly string[];
 extraUserCop:number;extraConnectionCop:number;
};
const pesos=(n:number)=>new Intl.NumberFormat('es-CO').format(n);
export default function PlansInteractive({plans}:{plans:PlanCardOption[]}){
 return <>
  <div className={styles.priceGrid}>
   {plans.map(plan=>{
    return <article key={plan.key} className={styles.priceCard}
     style={{borderColor:'#e6bb19',background:'#fffdf5',
      boxShadow:plan.featured?'0 0 0 2px #172235, 0 15px 40px rgba(244,191,0,.13)':'0 7px 22px rgba(244,191,0,.07)',
      display:'flex',flexDirection:'column',gap:0}}>
     <span className={styles.priceLabel}>{plan.eyebrow}</span>
     <h3>{plan.name}</h3>
     <div className={styles.price}>${pesos(plan.price)}
      <span style={{fontSize:14,fontWeight:500}}> / mes</span>
     </div>
     <p style={{fontSize:12,fontWeight:750,color:plan.published?'#166036':'#85610a'}}>
      {plan.published?'Tarifa publicada en ambiente de pruebas':'Propuesta orientativa · pendiente de aprobación'}
     </p>
     <p style={{fontSize:14,color:'#657187',margin:'10px 0'}}>{plan.summary}</p>
     <p style={{fontWeight:800,marginBottom:8}}>{plan.users} usuarios · {plan.connections} conexiones</p>
     <ul>{plan.highlights.map(x=><li key={x}>{x}</li>)}</ul>
     <details style={{margin:'18px 0',padding:12,background:'#f7f8fb',borderRadius:12}}>
      <summary style={{cursor:'pointer',fontWeight:800}}>Ver más: todas las funciones del plan</summary>
      <h4 style={{margin:'16px 0 8px'}}>Incluye</h4>
      <ul style={{minHeight:0,marginBottom:12}}>{plan.included.map(x=><li key={x}>{x}</li>)}</ul>
      <h4 style={{margin:'16px 0 8px'}}>Condiciones y disponibilidad</h4>
      <ul style={{minHeight:0}}>{plan.conditional.map(x=><li key={x}>{x}</li>)}</ul>
     </details>
     <div style={{marginTop:'auto',display:'grid',gap:9}}>
      <Link href={`/prueba-gratis?plan=${plan.key}`} className={styles.primaryButton}
       style={{display:'flex',width:'100%',background:'#f4bf00',color:'#172235',fontWeight:850}}>
       Elegir plan {plan.name}
      </Link>
      <p style={{fontSize:12,color:'#68758b',marginTop:4,lineHeight:1.5}}>
       Continúa a la solicitud de prueba, sin pago automático. <Link href={`/demo?plan=${plan.key}`}
        style={{textDecoration:'underline',textUnderlineOffset:3}}>Prefiero una demo</Link>
      </p>
     </div>
    </article>;
   })}
  </div>
 </>;
}
