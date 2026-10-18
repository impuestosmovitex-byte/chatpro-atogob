import Link from "next/link";
import {
  HeroMedia,
  MarketingHeader,
  ProductPreview,
} from "../components/marketing/MarketingHeader";
import styles from "../components/marketing/marketing.module.css";

const benefits = [
  {
    icon: "IA",
    title: "Atiende a tiempo, incluso cuando tu equipo no está",
    copy: "Automatiza respuestas y deja que la IA ayude a tus clientes 24/7 con información real de tu negocio.",
  },
  {
    icon: "CRM",
    title: "Cada interesado queda organizado",
    copy: "Guarda leads, notas, intereses, estados y seguimientos para que ninguna oportunidad se pierda.",
  },
  {
    icon: "VEN",
    title: "Vende dentro de la conversación",
    copy: "Comparte catálogo, opciones de pago y la información que el cliente necesita para avanzar.",
  },
  {
    icon: "AUT",
    title: "Automatiza procesos repetitivos",
    copy: "Crea seguimientos, respuestas y flujos para liberar tiempo de tu equipo sin perder control.",
  },
];

export default function InicioPage() {
  return (
    <main className={styles.site}>
      <MarketingHeader />

      <section className={styles.hero}>
        <div>
          <div className={styles.eyebrow}>CRM con IA para atención y automatización</div>
          <h1>
            ¿Cansado de perder ventas por{" "}
            <span className={styles.heroHighlight}>no atender rápido</span> a tus clientes?
          </h1>
          <p className={styles.heroCopy}>
            Conecta la IA a tu negocio, mejora la experiencia de tus clientes
            y aumenta tus resultados automatizando procesos clave de tu empresa.
          </p>

          <div className={styles.heroActions}>
            <Link href="/demo" className={styles.primaryButton}>Solicitar demo</Link>
            <Link href="/precios" className={styles.secondaryButton}>Ver planes</Link>
          </div>
        </div>

        <HeroMedia />
      </section>

      <section className={styles.heroStrip} aria-label="Canales y funciones principales">
        <div className={styles.stripLead}>
          <strong>Conecta tus canales y herramientas en un solo lugar</strong>
          <span>Atiende, vende y haz seguimiento desde MW1.</span>
        </div>

        {[
          ["WA", "WhatsApp"],
          ["IG", "Instagram"],
          ["TG", "Telegram"],
          ["WEB", "Chat web"],
          ["CAT", "Catálogo"],
          ["PAG", "Pasarela de pago"],
          ["DAT", "Información real"],
          ["24/7", "Atención 24/7"],
        ].map(([short, name]) => (
          <div className={styles.stripItem} key={name}>
            <span>{short}</span>
            <strong>{name}</strong>
          </div>
        ))}
      </section>

      <section className={styles.section} id="por-que">
        <div className={styles.sectionIntro}>
          <div className={styles.eyebrow}>¿Por qué tener MW1?</div>
          <h2>Tu equipo atiende mejor cuando toda la información está en el mismo lugar.</h2>
          <p>
            MW1 conecta conversaciones, clientes, ventas y automatizaciones para que
            responder rápido no dependa de revisar varias aplicaciones al mismo tiempo.
          </p>
        </div>

        <div className={styles.benefitGrid}>
          {benefits.map((benefit) => (
            <article className={styles.benefitCard} key={benefit.title}>
              <div className={styles.benefitIcon}>{benefit.icon}</div>
              <h3>{benefit.title}</h3>
              <p>{benefit.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={`${styles.section} ${styles.previewSection}`} id="demo">
        <div className={styles.sectionIntroCentered}>
          <div className={styles.eyebrow}>Todo en un solo lugar</div>
          <h2>Una vista simple para atender, vender y hacer seguimiento.</h2>
          <p>
            Mira conversaciones, contexto del cliente, estado comercial, notas y automatizaciones
            sin perder el hilo de la atención.
          </p>
        </div>
        <ProductPreview />
      </section>

      <section className={styles.section} id="integraciones">
        <div className={styles.sectionIntroCentered}>
          <div className={styles.eyebrow}>Integraciones</div>
          <h2>Conecta los canales donde tus clientes ya te escriben.</h2>
          <p>Empieza con los canales que necesitas y amplía tu operación cuando tu negocio crezca.</p>
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

      <section className={styles.section} id="precios">
        <div className={styles.sectionIntroCentered}>
          <div className={styles.eyebrow}>Planes</div>
          <h2>Empieza con lo que necesitas y crece con MW1.</h2>
          <p>La estructura ya está lista para definir contigo precios, límites y beneficios finales.</p>
        </div>

        <div className={styles.priceGrid}>
          <article className={styles.priceCard}>
            <span className={styles.priceLabel}>Para comenzar</span>
            <h3>Inicial</h3>
            <div className={styles.price}>— <small>precio por definir</small></div>
            <ul>
              <li>Bandeja centralizada</li>
              <li>Leads y seguimiento</li>
              <li>Catálogo e información del negocio</li>
              <li>Automatizaciones esenciales</li>
            </ul>
            <Link href="/precios" className={styles.secondaryButton}>Ver plan</Link>
          </article>

          <article className={`${styles.priceCard} ${styles.priceCardFeatured}`}>
            <span className={styles.priceLabel}>Más completo</span>
            <h3>Pro</h3>
            <div className={styles.price}>— <small>precio por definir</small></div>
            <ul>
              <li>Todo lo del plan Inicial</li>
              <li>IA para atención y ventas</li>
              <li>Automatizaciones avanzadas</li>
              <li>Más usuarios y reportes</li>
            </ul>
            <Link href="/demo" className={styles.primaryButton}>Solicitar demo</Link>
          </article>

          <article className={styles.priceCard}>
            <span className={styles.priceLabel}>Para equipos</span>
            <h3>Empresa</h3>
            <div className={styles.price}>— <small>precio personalizado</small></div>
            <ul>
              <li>Equipos y permisos</li>
              <li>Integraciones avanzadas</li>
              <li>Flujos personalizados</li>
              <li>Acompañamiento de implementación</li>
            </ul>
            <Link href="/precios" className={styles.secondaryButton}>Conocer opciones</Link>
          </article>
        </div>
      </section>

      <section className={styles.ctaBand}>
        <div>
          <h2>¿Quieres ver cómo funcionaría MW1 en tu empresa?</h2>
          <p>Revisamos tu proceso actual y te mostramos una demo enfocada en tu operación.</p>
        </div>
        <Link href="/demo" className={styles.primaryButton}>Solicitar demo</Link>
      </section>

      <footer className={styles.footer}>MW1 · CRM para atención, ventas y automatización</footer>
    </main>
  );
}
