import type {Metadata} from 'next';
import Link from 'next/link';
import {MarketingHeader} from '../components/marketing/MarketingHeader';
import {DemoRequestForm} from '../demo/DemoRequestForm';
import styles from '../components/marketing/marketing.module.css';

export const metadata:Metadata={
 title:'Solicita 14 días de prueba guiada | MW1',
 description:'Elige un plan MW1 y solicita una prueba gratuita guiada. Nuestro equipo revisará la conexión de WhatsApp antes de iniciar los 14 días.',
};
export default function PruebaGratisPage(){
 return <main className={styles.site}>
  <MarketingHeader/>
  <section className={styles.section}>
   <div className={styles.sectionIntroCentered}>
    <div className={styles.eyebrow}>Prueba guiada MW1 · 14 días</div>
    <h2>Elige tu plan y conoce MW1 con tu negocio.</h2>
    <p>Solicita una prueba de 14 días con acompañamiento para conectar tu primer canal y empezar a atender clientes. Sin tarjeta ni cobros automáticos durante la solicitud.</p>
    <p className={styles.pricingClarification}>
      <strong>Importante:</strong> los 14 días comienzan cuando un asesor confirma que tu cuenta está activada,
      no cuando envías este formulario. Sujeta a revisión técnica de la conexión y disponibilidad del servicio.
    </p>
   </div>
   <div className={styles.demoGrid}>
    <article className={styles.demoMain}>
     <h3>¿Qué sucede después de solicitar la prueba?</h3>
     <div className={styles.demoSteps}>
      <div className={styles.demoStep}><span>1</span><div><strong>Eliges Básico, Eco o Pro</strong><small>Indica los datos de contacto y cómo utilizas WhatsApp.</small></div></div>
      <div className={styles.demoStep}><span>2</span><div><strong>Validamos tu configuración</strong><small>Un asesor confirma el plan y la forma más segura de conectar el número.</small></div></div>
      <div className={styles.demoStep}><span>3</span><div><strong>Activamos tu cuenta independiente</strong><small>Después de confirmar los accesos y el canal, te comunicamos la fecha de inicio y fin de la prueba.</small></div></div>
      <div className={styles.demoStep}><span>4</span><div><strong>Decides si continúas</strong><small>Al finalizar, podrás elegir la suscripción. La prueba no activa renovaciones automáticas ni facturación por sí sola.</small></div></div>
     </div>
     <div style={{padding:19,background:'#f4f7fc',borderRadius:14,marginTop:22,color:'#3f4f65'}}>
      <strong>¿Ya utilizas WhatsApp Business?</strong>
      <p style={{margin:'10px 0',lineHeight:1.7}}>No es necesario eliminar la aplicación antes de consultarnos. Meta y algunos proveedores permiten coexistencia entre la app y la API en determinados casos; verificaremos las condiciones y las opciones para conservar tu número e historial antes de cualquier cambio.</p>
      <p style={{fontSize:12,lineHeight:1.7}}>Las integraciones y los cargos de mensajería de Meta pueden tener condiciones y precios independientes. Algunas funciones dependen de aprobación, canal y plan.</p>
     </div>
     <p style={{marginTop:20}}><Link href="/precios">Comparar los tres planes →</Link></p>
    </article>
    <article className={styles.demoCard}>
      <h3>Solicitar mis 14 días de prueba</h3>
      <p>Déjanos tus datos y el plan que te interesa. Te contactaremos para validar la incorporación.</p>
      {process.env.MW1_STAGING_MODE==='true'?<DemoRequestForm mode="trial"/>:
       <p>Las solicitudes se habilitarán después de completar las pruebas de seguridad y soporte.</p>}
      <div style={{marginTop:18}}><Link href="/login" className={styles.secondaryButton}>Ya tengo una cuenta</Link></div>
    </article>
   </div>
  </section>
  <footer className={styles.footer}>MW1 · Prueba guiada sujeta a confirmación. Ningún pago ni cuenta se activa al completar este formulario.</footer>
 </main>;
}
