import Link from "next/link";
import PublicPlanSimulator from "./PublicPlanSimulator";
import {MarketingHeader} from "../components/marketing/MarketingHeader";
import {MW1_COMMERCIAL_PROPOSAL} from "../lib/mw1-commercial-proposal";
import styles from "../components/marketing/marketing.module.css";

type PublishedRow={plan_key:string;price_cop:number;max_users:number;max_whatsapp_lines:number};
async function readPublished():Promise<PublishedRow[]>{
 if(process.env.MW1_STAGING_MODE!=='true')return [];
 const base=process.env.CHATPRO_API_URL?.trim(),key=process.env.CHATPRO_INBOX_KEY?.trim();
 if(!base||!key)return [];
 try{
  const response=await fetch(new URL('/platform-admin/plans/public',base),{headers:{'x-chatpro-inbox-key':key},cache:'no-store',signal:AbortSignal.timeout(8000)});
  if(!response.ok)return [];
  const result=await response.json() as {plans?:PublishedRow[]};
  return Array.isArray(result.plans)?result.plans.filter(x=>Number.isSafeInteger(x.price_cop)&&x.price_cop>0&&Number.isSafeInteger(x.max_users)&&x.max_users>0&&Number.isSafeInteger(x.max_whatsapp_lines)&&x.max_whatsapp_lines>0):[];
 }catch{return [];}
}
const pesos=(n:number)=>new Intl.NumberFormat('es-CO').format(n);
export default async function PreciosPage(){
 const published=await readPublished();
 const prices=MW1_COMMERCIAL_PROPOSAL.map(plan=>{
  const found=published.find(p=>p.plan_key===plan.legacyKey);
  return {...plan,price:found?.price_cop??plan.price,users:found?.max_users??plan.users,connections:found?.max_whatsapp_lines??plan.connections};
 });
 return <main className={styles.site}>
  <MarketingHeader/>
  <section className={styles.section}>
   <div className={styles.sectionIntroCentered}>
    <div className={styles.eyebrow}>Planes MW1</div>
    <h2>Elige el plan que se ajusta a tu negocio.</h2>
    <p>Desde pequeños comercios hasta equipos de ventas: clientes y conversaciones en una sola plataforma.</p>
    <p className={styles.pricingClarification}>Tarifas orientativas sujetas a confirmación. Las funciones todavía en desarrollo se identifican expresamente.</p>
   </div>
   <div className={styles.priceGrid}>
    {prices.map(plan=><article key={plan.key} className={plan.featured?`${styles.priceCard} ${styles.priceCardFeatured}`:styles.priceCard}>
     <span className={styles.priceLabel}>{plan.eyebrow}</span>
     <h3>{plan.name}</h3>
     <div className={styles.price}>${pesos(plan.price)}<span style={{fontSize:14,fontWeight:500}}> / mes</span></div>
     <p style={{fontSize:14,color:'#657187',margin:'10px 0'}}>{plan.summary}</p>
     <p style={{fontWeight:800,marginBottom:8}}>{plan.users} usuarios · {plan.connections} conexiones</p>
     <ul>{plan.highlights.map(x=><li key={x}>{x}</li>)}</ul>
     <details style={{margin:'18px 0',padding:12,background:'#f7f8fb',borderRadius:12}}>
      <summary style={{cursor:'pointer',fontWeight:800}}>Ver más: todas las funciones del plan</summary>
      <h4 style={{margin:'16px 0 8px'}}>Incluye</h4><ul>{plan.included.map(x=><li key={x}>{x}</li>)}</ul>
      <h4 style={{margin:'16px 0 8px'}}>Condiciones y disponibilidad</h4><ul>{plan.conditional.map(x=><li key={x}>{x}</li>)}</ul>
     </details>
     <Link href={`/demo?plan=${plan.key}`} className={plan.featured?styles.primaryButton:styles.secondaryButton}>Solicitar demo</Link>
    </article>)}
   </div>
   <PublicPlanSimulator options={prices.map(p=>({key:p.key,name:p.name,price:p.price,users:p.users,connections:p.connections}))}/>
  </section>
  <footer className={styles.footer}>MW1 · Precios orientativos pendientes de aprobación</footer>
 </main>;
}
