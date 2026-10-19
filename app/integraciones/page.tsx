import Link from "next/link";
import { MarketingIcon, type MarketingIconName } from "../components/marketing/MarketingIcon";
import { MarketingHeader } from "../components/marketing/MarketingHeader";
import styles from "../components/marketing/marketing.module.css";

const channels: {icon: MarketingIconName; name: string}[] = [
  {icon:"whatsapp",name:"WhatsApp"},{icon:"instagram",name:"Instagram"},
  {icon:"messenger",name:"Messenger"},{icon:"telegram",name:"Telegram"},
  {icon:"web",name:"Chat web"},
];

export default function IntegracionesPage() {
  return (
    <main className={styles.site}>
      <MarketingHeader />
      <section className={styles.section}>
        <div className={styles.sectionIntroCentered}>
          <div className={styles.eyebrow}>Integraciones de MW1</div>
          <h2>Conecta los canales y herramientas con los que tu empresa ya funciona.</h2>
          <p>Reúne la atención al cliente, tu tienda virtual y tus catálogos en una misma experiencia. Cada integración requiere su configuración y disponibilidad correspondientes.</p>
        </div>
        <div className={styles.integrationSection}>
          <div className={styles.integrationSectionIntro}><span className={styles.eyebrow}>Canales de atención</span><h3>Las conversaciones de tu negocio, organizadas.</h3><p>Una vista para acompañar a tus clientes en sus canales habituales.</p></div>
          <div className={styles.integrationGrid}>
            {channels.map(item=>(
              <article className={styles.integrationCard} data-channel={item.icon} key={item.name}>
                <div className={styles.integrationBadge}><MarketingIcon name={item.icon}/></div>
                <strong>{item.name}</strong>
              </article>
            ))}
          </div>
        </div>
        <div className={styles.integrationSection}>
          <div className={styles.integrationSectionIntro}><span className={styles.eyebrow}>Comercio electrónico</span><h3>Conecta tu tienda virtual.</h3><p>Explora las conexiones para consultar productos, compartir información comercial y mejorar la atención.</p></div>
          <div className={styles.connectGrid}>
            <article className={styles.connectCard}><span className={styles.platformMark} data-brand="shopify">S</span><h4>Shopify</h4><p>Información de catálogo y comercio para tu atención.</p><span className={styles.connectNote}>Integración según configuración</span></article>
            <article className={styles.connectCard}><span className={styles.platformMark} data-brand="woo">W</span><h4>WordPress / WooCommerce</h4><p>Opciones para conectar los productos de tu tienda.</p><span className={styles.connectNote}>Disponibilidad por confirmar</span></article>
            <article className={styles.connectCard}><span className={styles.platformMark} data-brand="nube">N</span><h4>Tiendanube</h4><p>Una plataforma contemplada para futuras conexiones.</p><span className={styles.connectNote}>Integración por desarrollar</span></article>
          </div>
        </div>
        <div className={styles.integrationSection}>
          <div className={styles.integrationSectionIntro}><span className={styles.eyebrow}>Catálogos y documentos</span><h3>Tu información comercial, siempre a mano.</h3><p>Comparte información útil sobre tus productos y servicios en el momento adecuado.</p></div>
          <div className={styles.connectGrid}>
            <article className={styles.connectCard}><span className={styles.connectIcon}><MarketingIcon name="catalog"/></span><h4>Catálogo de productos</h4><p>Presenta las opciones de tu negocio durante una conversación.</p></article>
            <article className={styles.connectCard}><span className={styles.connectIcon}><MarketingIcon name="database"/></span><h4>Catálogos PDF</h4><p>Una opción prevista para usar tus documentos comerciales como referencia.</p><span className={styles.connectNote}>Función por habilitar</span></article>
            <article className={styles.connectCard}><span className={styles.connectIcon}><MarketingIcon name="bot"/></span><h4>Información para la IA</h4><p>Horarios, políticas y respuestas según las reglas de tu empresa.</p></article>
          </div>
        </div>
        <div className={styles.integrationClosing}><div><h3>¿Quieres conocer qué puedes conectar hoy?</h3><p>Te ayudamos a revisar las opciones disponibles para tu negocio.</p></div><Link href="/demo" className={styles.primaryButton}>Conocer MW1</Link></div>
      </section>
      <footer className={styles.footer}>MW1 · Integraciones</footer>
    </main>
  );
}
