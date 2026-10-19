import { MarketingIcon, type MarketingIconName } from "../components/marketing/MarketingIcon";
import { MarketingHeader } from "../components/marketing/MarketingHeader";
import styles from "../components/marketing/marketing.module.css";

export default function IntegracionesPage() {
  return (
    <main className={styles.site}>
      <MarketingHeader />
      <section className={styles.section}>
        <div className={styles.sectionIntroCentered}>
          <div className={styles.eyebrow}>Integraciones</div>
          <h2>Conecta los canales donde tus clientes ya te escriben.</h2>
          <p>
            Explora los canales que MW1 contempla para centralizar conversaciones. La disponibilidad de cada conexión depende de su configuración y habilitación.
          </p>
        </div>

        <div className={styles.integrationGrid}>
          {([
            ["whatsapp", "WhatsApp"],
            ["instagram", "Instagram"],
            ["messenger", "Messenger"],
            ["telegram", "Telegram"],
            ["web", "Chat web"],
          ] as [MarketingIconName, string][]).map(([icon, name]) => (
            <article className={styles.integrationCard} data-channel={icon} key={name}>
              <div className={styles.integrationBadge}><MarketingIcon name={icon} /></div>
              <strong>{name}</strong>
            </article>
          ))}
        </div>
      </section>
      <footer className={styles.footer}>MW1 · Integraciones</footer>
    </main>
  );
}
