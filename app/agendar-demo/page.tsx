import type {Metadata} from 'next';
import Link from 'next/link';
import {MarketingHeader} from '../components/marketing/MarketingHeader';
import {DemoRequestForm} from '../demo/DemoRequestForm';
import styles from '../components/marketing/marketing.module.css';

// Server-render at request time so the existing staging flag cannot be frozen during build.
export const dynamic='force-dynamic';

export const metadata:Metadata={
 title:'Solicitar una demostración de MW1',
 description:'Solicita una demostración del CRM MW1. El equipo comercial continuará el contacto.',
};

export default function AgendarDemoPage(){
 return <main className={styles.site}>
  <MarketingHeader/>
  <section className={styles.section}>
   <div className={styles.sectionIntroCentered}>
    <div className={styles.eyebrow}>Conoce MW1 para tu empresa</div>
    <h1 style={{fontSize:'clamp(34px,5vw,56px)',lineHeight:1.1,letterSpacing:'-.04em',margin:'12px 0'}}>Solicita una demostración de MW1.</h1>
    <p>Déjanos tus datos y descubre cómo MW1 puede transformar la atención de tu negocio. Nuestro equipo comercial se pondrá en contacto contigo.</p>
   </div>
   <div style={{maxWidth:650,margin:'32px auto',background:'#fff',border:'1px solid #e0e6ef',borderRadius:24,padding:'clamp(20px,4vw,40px)',boxShadow:'0 18px 50px rgba(23,34,53,.06)'}}>
    <h2 style={{fontSize:23,letterSpacing:'-.025em'}}>Déjanos tus datos</h2>
    <p style={{color:'#58667c',fontSize:14,lineHeight:1.7,marginTop:10}}>Conversemos sobre cómo MW1 puede ayudarte a vender mejor y trabajar con más tranquilidad.</p>
    {process.env.MW1_STAGING_MODE==='true'
      ?<DemoRequestForm/>
      :<p style={{padding:'22px 0',color:'#58667c'}}>El registro en línea se habilitará después de las validaciones de seguridad y privacidad.</p>}
   </div>
   <div className={styles.sectionIntroCentered}>
    <h2>Más ventas, menos tareas repetitivas y más tranquilidad para emprender.</h2>
    <p>Conoce una plataforma diseñada para ayudarte a aprovechar más oportunidades de venta, reducir tareas operativas y mejorar la rentabilidad mediante una atención más organizada.</p>
    <Link href="/demo" className={styles.secondaryButton}>Conocer cómo funciona MW1</Link>
   </div>
  </section>
  <footer className={styles.footer}>MW1 · Solicitudes de demostración</footer>
 </main>;
}
