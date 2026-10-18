import Link from "next/link";
import styles from "./marketing.module.css";

export function MarketingHeader() {
  return (
    <header className={styles.header}>
      <div className={styles.navWrap}>
        <Link href="/inicio" className={styles.logo} aria-label="MW1 inicio">
          <span className={styles.logoMark}>M</span>
          <span>MW1</span>
        </Link>

        <nav className={styles.nav} aria-label="Navegación principal">
          <Link href="/inicio#por-que">¿Por qué tenerlo?</Link>
          <Link href="/precios">Precios</Link>
          <Link href="/demo">Demo</Link>
          <Link href="/integraciones">Integraciones</Link>
        </nav>

        <div className={styles.navActions}>
          <Link href="/login" className={styles.secondaryButton}>
            Iniciar sesión
          </Link>
          <Link href="/demo" className={styles.primaryButton}>
            Solicitar demo
          </Link>
        </div>
      </div>
    </header>
  );
}

export function HeroMedia() {
  return (
    <div className={styles.heroMedia}>
      <div className={styles.heroGlow} />
      <img
        src="data:image/webp;base64,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"
        alt="Emprendedora mostrando su computador"
        className={styles.heroPhoto}
      />
      <div className={[styles.heroMetric, styles.heroMetricTop].join(" ")}>
        <span className={styles.metricIcon}>IA</span>
        <div>
          <strong>Respuesta inmediata</strong>
          <small>Atiende incluso cuando tu equipo no está.</small>
        </div>
      </div>
      <div className={[styles.heroMetric, styles.heroMetricBottom].join(" ")}>
        <span className={styles.metricIcon}>↗</span>
        <div>
          <strong>Más oportunidades</strong>
          <small>Organiza y haz seguimiento a cada interesado.</small>
        </div>
      </div>
    </div>
  );
}

export function ProductPreview() {
  return (
    <div className={styles.productWindow}>
      <div className={styles.windowBar}>
        <span className={styles.windowLogo}>MW1</span>
        <div className={styles.windowSearch}>Buscar conversaciones, contactos o leads...</div>
        <span className={styles.windowUser}>Equipo MW1</span>
      </div>

      <div className={styles.productGrid}>
        <aside className={styles.previewSidebar}>
          <strong>MW1</strong>
          <span className={styles.previewActive}>Conversaciones</span>
          <span>Leads</span>
          <span>Clientes</span>
          <span>Automatizaciones</span>
          <span>Estadísticas</span>
          <span>Integraciones</span>
        </aside>

        <div className={styles.conversationList}>
          <div className={styles.previewTitle}>Conversaciones</div>
          <div className={styles.previewTabs}>
            <span className={styles.activeTab}>Todas</span>
            <span>WhatsApp</span>
            <span>Instagram</span>
            <span>Telegram</span>
          </div>
          {[
            ["María González", "Quiero conocer los planes", "WA"],
            ["Carlos Ramírez", "¿Tienen integración con pagos?", "IG"],
            ["Laura Torres", "Quiero agendar una demo", "TG"],
            ["Empresa Nova", "Necesito ayuda con un cliente", "WEB"],
          ].map(([name, message, channel]) => (
            <div className={styles.previewConversation} key={name}>
              <span className={styles.previewAvatar}>{name.charAt(0)}</span>
              <div>
                <strong>{name}</strong>
                <small>{message}</small>
              </div>
              <span className={styles.previewChannel}>{channel}</span>
            </div>
          ))}
        </div>

        <div className={styles.chatPanel}>
          <div className={styles.chatHeader}>
            <div>
              <strong>María González</strong>
              <small>Lead interesado · WhatsApp</small>
            </div>
            <span className={styles.statusPill}>En seguimiento</span>
          </div>
          <div className={styles.customerMessage}>
            Hola, estoy interesada. ¿Me pueden contar cómo funciona?
          </div>
          <div className={styles.companyMessage}>
            ¡Claro! Podemos centralizar tu atención, automatizar respuestas y
            ayudarte a hacer seguimiento a cada oportunidad.
          </div>
          <div className={styles.catalogCard}>
            <span>Catálogo</span>
            <strong>Productos, servicios y pagos en la conversación</strong>
            <button type="button">Ver catálogo</button>
          </div>
          <div className={styles.fakeComposer}>Escribe un mensaje...</div>
        </div>

        <aside className={styles.contactPanel}>
          <div className={styles.contactAvatar}>MG</div>
          <strong>María González</strong>
          <span className={styles.leadBadge}>Lead calificado</span>
          <dl>
            <div><dt>Origen</dt><dd>WhatsApp</dd></div>
            <div><dt>Interés</dt><dd>Plan para equipo</dd></div>
            <div><dt>Estado</dt><dd>Interesado</dd></div>
          </dl>
          <div className={styles.noteBox}>
            <strong>Nota</strong>
            <small>Solicitó precios y demo. Hacer seguimiento hoy.</small>
          </div>
        </aside>
      </div>
    </div>
  );
}
