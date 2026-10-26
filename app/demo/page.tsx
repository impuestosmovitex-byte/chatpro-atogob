import Link from "next/link";
import {
  MarketingHeader,
  ProductPreview,
} from "../components/marketing/MarketingHeader";
import styles from "../components/marketing/marketing.module.css";
import {DemoRequestForm} from "./DemoRequestForm";

export default function DemoPage() {
  return (
    <main className={styles.site}>
      <MarketingHeader />

      <section className={styles.section}>
        <div className={styles.sectionIntroCentered}>
          <div className={styles.eyebrow}>Demo de MW1</div>
          <h2>Una vista simple para atender, vender y hacer seguimiento.</h2>
          <p>
            Conoce cómo se organizan las conversaciones, el contexto comercial y los seguimientos en un solo lugar. Esta demostración utiliza datos de ejemplo.
          </p>
        </div>

        <ProductPreview />
      </section>

      <section className={styles.section}>
        <div className={styles.demoGrid}>
          <article className={styles.demoMain}>
            <h3>Demo para ventas</h3>
            <p>Recorre el flujo desde que llega un cliente hasta que queda listo para seguimiento comercial.</p>
            <div className={styles.demoSteps}>
              <div className={styles.demoStep}><span>1</span><div><strong>Entra una conversación</strong><small>WhatsApp, Instagram o Messenger, según los canales configurados.</small></div></div>
              <div className={styles.demoStep}><span>2</span><div><strong>MW1 conserva el contexto</strong><small>Datos, interés, notas y estado del lead.</small></div></div>
              <div className={styles.demoStep}><span>3</span><div><strong>Tu equipo continúa</strong><small>Atiende manualmente o con apoyo de IA y automatizaciones.</small></div></div>
            </div>
          </article>

          <article className={styles.demoCard}>
            <h3>Solicitar una demo personalizada</h3>
            <p>Primero conocemos tu negocio y te mostramos MW1. Si decides contratar, recibirás las instrucciones de pago por un enlace seguro y te acompañaremos en la configuración de canales, usuarios e IA.</p>
            {process.env.MW1_STAGING_MODE==='true'?<DemoRequestForm/>:
              <p>Las solicitudes en línea se habilitarán cuando finalicemos las pruebas de seguridad y privacidad.</p>}
            <div style={{ marginTop: 22, display:'flex', gap:12, flexWrap:'wrap', alignItems:'center' }}>
              <Link href="/precios" className={styles.primaryButton}>Consultar planes y acompañamiento</Link>
              <Link href="/login" className={styles.secondaryButton}>Ya soy cliente</Link>
            </div>
          </article>
        </div>
      </section>

      <section className={styles.section} aria-label="Cómo empezar con MW1">
        <div className={styles.sectionIntroCentered}>
          <div className={styles.eyebrow}>Implementación acompañada</div>
          <h2>Tu empresa comienza con una demostración, no con un cobro automático.</h2>
          <p>1. Solicitas una demo · 2. Un asesor te ayuda a elegir tu plan · 3. Pagas por un enlace seguro del proveedor · 4. Recibes el acceso del propietario y conectas tus canales con nuestro acompañamiento.</p>
          <p>La primera contratación y activación son supervisadas. Las renovaciones automáticas todavía no están disponibles.</p>
        </div>
      </section>
      <footer className={styles.footer}>MW1 · Demo del producto</footer>
    </main>
  );
}
