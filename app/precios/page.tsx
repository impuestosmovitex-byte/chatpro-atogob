import PlansInteractive from "./PlansInteractive";
import {MarketingHeader} from "../components/marketing/MarketingHeader";
import {MW1_COMMERCIAL_PROPOSAL} from "../lib/mw1-commercial-proposal";
import styles from "../components/marketing/marketing.module.css";

type PublishedRow={plan_key:string;price_cop:number;max_users:number;max_whatsapp_lines:number;extra_user_cop:number|null;extra_connection_cop:number|null;public_summary:string|null;public_features:string[]|null};
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
  return {...plan,published:!!found,price:found?.price_cop??plan.price,users:found?.max_users??plan.users,connections:found?.max_whatsapp_lines??plan.connections,extraUserCop:found?.extra_user_cop??32000,extraConnectionCop:found?.extra_connection_cop??50000,summary:found?.public_summary?.trim()||plan.summary,included:Array.isArray(found?.public_features)&&found.public_features.length>0?found.public_features.filter((x):x is string=>typeof x==='string').slice(0,20):plan.included};
 });
 return <main className={styles.site}>
  <MarketingHeader/>
  <section className={styles.section}>
   <div className={styles.sectionIntroCentered}>
    <div className={styles.eyebrow}>Planes MW1</div>
    <h2>Elige el plan que se ajusta a tu negocio.</h2>
    <p>Desde pequeños comercios hasta equipos de ventas: clientes y conversaciones en una sola plataforma. Selecciona el plan que quieras y solicita la configuración asistida.</p>
    <p className={styles.pricingClarification}>Las tarifas publicadas se indican en cada plan. Los demás valores son referencias provisionales. Ninguno representa un cobro automático ni activa suscripciones.</p>
   </div>
   <PlansInteractive plans={prices}/>
  </section>
  <footer className={styles.footer}>MW1 · Los precios configurados en pruebas no generan pagos ni activan cuentas. Las condiciones comerciales requieren confirmación.</footer>
 </main>;
}
