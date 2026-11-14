import type {Metadata} from 'next';
import Link from 'next/link';
import {MarketingHeader} from '../components/marketing/MarketingHeader';
import {DemoRequestForm} from '../demo/DemoRequestForm';
import styles from '../components/marketing/marketing.module.css';

export const metadata:Metadata={
 title:'Agendar una demostración de MW1',
 description:'Solicita una reunión guiada para conocer el CRM MW1. Un asesor confirma la disponibilidad y el horario.',
};

export default function AgendarDemoPage(){
 return <main className={styles.site}>
  <MarketingHeader/>
  <section className={styles.section}>
   <div className={styles.sectionIntroCentered}>
    <div className={styles.eyebrow}>Conoce MW1 para tu empresa</div>
    <h1 style={{fontSize:'clamp(34px,5vw,56px)',lineHeight:1.1,letterSpacing:'-.04em',margin:'12px 0'}}>Agenda una demostración personalizada.</h1>
    <p>Cuéntanos quién eres y qué necesita tu empresa. Te contactaremos para coordinar el día y la hora. El envío de este formulario todavía no confirma una reserva.</p>
   </div>
   <div style={{maxWidth:650,margin:'32px auto',background:'#fff',border:'1px solid #e0e6ef',borderRadius:24,padding:'clamp(20px,4vw,40px)',boxShadow:'0 18px 50px rgba(23,34,53,.06)'}}>
    <h2 style={{fontSize:23,letterSpacing:'-.025em'}}>Solicita tu reunión</h2>
    <p style={{color:'#58667c',fontSize:14,lineHeight:1.7,marginTop:10}}>La solicitud utiliza el registro comercial existente de MW1. No crea una cuenta, no conecta WhatsApp y no genera cobros.</p>
    {process.env.MW1_STAGING_MODE==='true'
      ?<DemoRequestForm/>
      :<p style={{padding:'22px 0',color:'#58667c'}}>El registro en línea se habilitará después de las validaciones de seguridad y privacidad.</p>}
   </div>
   <div className={styles.sectionIntroCentered}>
    <h2>¿Qué veremos en la reunión?</h2>
    <p>Bandeja de conversaciones, atención con IA cuando esté habilitada, trabajo entre asesores y seguimiento comercial. La disponibilidad de cada integración depende de las conexiones aprobadas.</p>
    <Link href="/demo" className={styles.secondaryButton}>Ver recorrido ilustrativo antes de agendar</Link>
   </div>
  </section>
  <footer className={styles.footer}>MW1 · Solicitudes comerciales supervisadas</footer>
 </main>;
}
