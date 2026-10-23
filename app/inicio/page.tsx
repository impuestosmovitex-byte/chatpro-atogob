import Link from "next/link";
import { MarketingIcon, type MarketingIconName } from "../components/marketing/MarketingIcon";
import { HeroMedia, MarketingHeader } from "../components/marketing/MarketingHeader";
import styles from "../components/marketing/marketing.module.css";

const channels: { icon: MarketingIconName; label: string }[] = [
  { icon: "whatsapp", label: "WhatsApp" },
  { icon: "instagram", label: "Instagram" },
  { icon: "messenger", label: "Messenger" },
  { icon: "telegram", label: "Telegram" },
  { icon: "web", label: "Sitio web" },
  { icon: "catalog", label: "Catálogo" },
  { icon: "payment", label: "Pagos" },
  { icon: "bot", label: "IA 24/7" },
];

const customization: {icon: MarketingIconName; title: string; description: string}[] = [
  { icon: "users", title: "Tu manera de comunicarte", description: "Define si tu atención es cercana, formal o comercial y conserva el estilo de tu marca." },
  { icon: "workflow", title: "Tus propias reglas", description: "Indica qué responder, cómo orientar una venta y cuándo debe intervenir tu equipo." },
  { icon: "database", title: "La información de tu negocio", description: "Organiza horarios, productos, políticas y respuestas con el contexto correcto." },
];

export default function InicioPage() {
  return (
    <main className={styles.site}>
      <MarketingHeader />

      <section className={styles.hero}>
        <div>
          <div className={styles.eyebrow}>CRM con IA para atención y automatización</div>
          <h1>¿Cansado de perder ventas por <span className={styles.heroHighlight}>no atender rápido</span> a tus clientes?</h1>
          <p className={styles.heroCopy}>
            Conecta la IA a tu negocio, mejora la experiencia de tus clientes
            y aumenta tus resultados automatizando procesos clave de tu empresa.
          </p>
          <div className={styles.heroActions}>
            <Link href="/prueba-gratis" className={styles.primaryButton}>Solicitar 14 días gratis <span aria-hidden="true">↗</span></Link>
            <Link href="/precios" className={styles.secondaryButton}>Ver planes</Link>
          </div>
          <p className={styles.heroFootnote}>Atención más organizada. Tu negocio mantiene el control.</p>
        </div>
        <HeroMedia />
      </section>

      <section className={styles.channelsArea} aria-labelledby="channels-heading">
        <div className={styles.heroStrip}>
          <div className={styles.stripLead}>
            <strong id="channels-heading">Conecta tus canales y herramientas en un solo lugar</strong>
            <span>Atiende, vende y haz seguimiento desde MW1.</span>
          </div>
          {channels.map(({icon,label})=>(
            <div className={styles.stripItem} data-channel={icon} key={label}>
              <span className={styles.channelGlyph}><MarketingIcon name={icon}/></span>
              <strong>{label}</strong>
            </div>
          ))}
        </div>

        <div className={styles.showcaseGrid}>
          <article className={styles.showcaseCard}>
            <div className={styles.showcaseTitle}>
              <span className={styles.showcaseIcon}><MarketingIcon name="catalog"/></span>
              <div><h3>Comparte tu catálogo</h3><p>Productos dentro de la conversación</p></div>
            </div>
            <div className={styles.sampleChat} aria-label="Ejemplo de envío de catálogo por chat">
              <div className={styles.sampleClient}>Hola, ¿me muestras lo que tienen?</div>
              <div className={styles.sampleProduct}>
                <span className={styles.sampleProductImage} aria-hidden="true">👗</span>
                <div><strong>Catálogo de productos</strong><small>Explora opciones y detalles</small><em>Ver productos ↗</em></div>
              </div>
              <span className={styles.sampleNote}>Vista ilustrativa</span>
            </div>
          </article>

          <article className={styles.showcaseCard}>
            <div className={styles.showcaseTitle}>
              <span className={styles.showcaseIcon}><MarketingIcon name="payment"/></span>
              <div><h3>Facilita el pago</h3><p>Acompaña al cliente hasta el cierre</p></div>
            </div>
            <div className={styles.sampleCheckout} aria-label="Ejemplo visual de información para pagos">
              <div className={styles.sampleCheckoutTop}><MarketingIcon name="payment"/><strong>Información de pago</strong></div>
              <div className={styles.sampleCheckoutLine}><span>Resumen de compra</span><span>✓</span></div>
              <div className={styles.sampleCheckoutLine}><span>Opciones disponibles</span><span>✓</span></div>
              <div className={styles.sampleCheckoutAction}>Continuar al pago <span aria-hidden="true">↗</span></div>
              <span className={styles.sampleNote}>Ejemplo, sin pagos reales</span>
            </div>
          </article>

          <article className={styles.showcaseCard}>
            <div className={styles.showcaseTitle}>
              <span className={styles.showcaseIcon}><MarketingIcon name="bot"/></span>
              <div><h3>Atención con IA 24/7</h3><p>Respuestas que mantienen tu estilo</p></div>
            </div>
            <div className={styles.sampleBot} aria-label="Ejemplo ilustrativo de atención automatizada">
              <div className={styles.sampleBotIdentity}><span className={styles.sampleRobot}><MarketingIcon name="bot"/></span><div><strong>Asistente MW1</strong><small>Atención automatizada</small></div><span className={styles.botOnline}>24/7</span></div>
              <p>¡Hola! Estoy aquí para ayudarte. ¿Qué información necesitas hoy?</p>
              <span className={styles.sampleNote}>Respuesta de ejemplo</span>
            </div>
          </article>
        </div>
      </section>

      <section className={styles.aiSection}>
        <div className={styles.aiSectionHeading}>
          <div>
            <div className={styles.eyebrow}>Una IA con tu identidad</div>
            <h2>Tu IA, con la personalidad de tu negocio.</h2>
          </div>
          <p>
            Personaliza cómo atiende: tu tono, tus reglas, tus estrategias comerciales
            y la filosofía con la que quieres comunicarte con cada cliente.
          </p>
        </div>
        <div className={styles.aiFeatures}>
          {customization.map(item=>(
            <article className={styles.aiFeature} key={item.title}>
              <span className={styles.aiFeatureIcon}><MarketingIcon name={item.icon}/></span>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
            </article>
          ))}
        </div>
        <Link href="/por-que" className={styles.textLink}>Descubre por qué usar MW1 <span aria-hidden="true">→</span></Link>
      </section>

      <section className={styles.homeCta}>
        <div className={styles.homeCtaContent}>
          <div className={styles.eyebrow}>Da el siguiente paso</div>
          <h2>Empieza hoy y descubre cómo MW1 puede ayudarte a atender mejor y vender más.</h2>
          <p>Organiza tus conversaciones, automatiza respuestas y mejora el seguimiento comercial desde un solo lugar.</p>
          <div className={styles.homeCtaActions}>
            <Link href="/prueba-gratis" className={styles.primaryButton}>Solicitar 14 días gratis <span aria-hidden="true">↗</span></Link>
            <Link href="/demo" className={styles.secondaryButton}>Ver cómo funciona</Link>
          </div>
        </div>
        <div className={styles.homeCtaDecoration} aria-hidden="true"><span>MW1</span><MarketingIcon name="sparkles"/></div>
      </section>

      <footer className={styles.footer}>MW1 · Atención, ventas y automatización con IA</footer>
    </main>
  );
}
