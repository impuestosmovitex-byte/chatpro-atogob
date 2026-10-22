import Link from "next/link";
import PublicPlanSimulator from "./PublicPlanSimulator";
import {MarketingHeader} from "../components/marketing/MarketingHeader";
import {MW1_COMMERCIAL_PROPOSAL} from "../lib/mw1-commercial-proposal";
import styles from "../components/marketing/marketing.module.css";

const pesos=(n:number)=>new Intl.NumberFormat('es-CO').format(n);
export default function PreciosPage(){
 return <main className={styles.site}>
  <MarketingHeader/>
  <section className={styles.section}>
   <div className={styles.sectionIntroCentered}>
    <div className={styles.eyebrow}>Planes MW1</div>
    <h2>Elige el plan que se ajusta a tu negocio.</h2>
    <p>Desde pequeños comercios hasta equipos de ventas: clientes y conversaciones en una sola plataforma.</p>
    <p className={styles.pricingClarification}>Propuesta en revisión, no oferta contractual. Funcionalidades pendientes señaladas expresamente.</p>
   </div>
   <div className={styles.priceGrid}>
    {MW1_COMMERCIAL_PROPOSAL.map(plan=><article key={plan.key} className={plan.featured?`${styles.priceCard} ${styles.priceCardFeatured}`:styles.priceCard}>
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
   <PublicPlanSimulator/>
  </section>
  <footer className={styles.footer}>MW1 · Precios orientativos pendientes de aprobación</footer>
 </main>;
}
