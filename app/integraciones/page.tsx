import { MarketingHeader } from "../components/marketing/MarketingHeader";
import styles from "../components/marketing/marketing.module.css";

export default function IntegracionesPage() {
  return (
    <main className={styles.site}>
      <MarketingHeader />
      <section className={styles.section}>
        <div className={styles.sectionIntroCentered}>
          <div className={styles.eyebrow}>Integraciones</div>
          <h2>Conecta MW1 con las herramientas que usa tu negocio.</h2>
          <p>
            La disponibilidad real depende de cada integración. Esta sección crecerá
            a medida que terminemos y habilitemos nuevos conectores.
          </p>
        </div>

        <div className={styles.integrationGrid}>
          {[
            ["WA", "WhatsApp"],
            ["IG", "Instagram"],
            ["MS", "Messenger"],
            ["TG", "Telegram"],
            ["WEB", "Chat web"],
          ].map(([short, name]) => (
            <article className={styles.integrationCard} key={name}>
              <div className={styles.integrationBadge}>{short}</div>
              <strong>{name}</strong>
            </article>
          ))}
        </div>
      </section>
      <footer className={styles.footer}>MW1 · Integraciones</footer>
    </main>
  );
}
