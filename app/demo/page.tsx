import Link from "next/link";
import {
  MarketingHeader,
  ProductPreview,
} from "../components/marketing/MarketingHeader";
import styles from "../components/marketing/marketing.module.css";

export default function DemoPage() {
  return (
    <main className={styles.site}>
      <MarketingHeader />

      <section className={styles.section}>
        <div className={styles.sectionIntroCentered}>
          <div className={styles.eyebrow}>Demo de MW1</div>
          <h2>Mira cómo se siente trabajar con todo conectado.</h2>
          <p>
            Explora una vista ilustrativa de MW1 con conversaciones y datos de ejemplo, sin exponer información real de clientes.
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
              <div className={styles.demoStep}><span>1</span><div><strong>Entra una conversación</strong><small>WhatsApp, Instagram, Telegram o web.</small></div></div>
              <div className={styles.demoStep}><span>2</span><div><strong>MW1 conserva el contexto</strong><small>Datos, interés, notas y estado del lead.</small></div></div>
              <div className={styles.demoStep}><span>3</span><div><strong>Tu equipo continúa</strong><small>Atiende manualmente o con apoyo de IA y automatizaciones.</small></div></div>
            </div>
          </article>

          <article className={styles.demoCard}>
            <h3>Solicitar una demo personalizada</h3>
            <p>Pronto podrás solicitar una demostración personalizada para tu empresa. Si ya tienes acceso, entra con tu cuenta actual.</p>
            <div style={{ marginTop: 22 }}>
              <Link href="/login" className={styles.primaryButton}>Ya soy cliente</Link>
            </div>
          </article>
        </div>
      </section>

      <footer className={styles.footer}>MW1 · Demo del producto</footer>
    </main>
  );
}
