import Link from "next/link";
import styles from "./marketing.module.css";

export function MarketingHeader() {
  return (
    <header className={styles.header}>
      <div className={styles.navWrap}>
        <Link href="/inicio" className={styles.logo} aria-label="MW1, ir al inicio">
          <span className={styles.logoMark}>M</span>
          <span>MW1</span>
        </Link>

        <nav className={styles.nav} aria-label="Navegación principal">
          <Link href="/inicio#por-que">¿Por qué MW1?</Link>
          <Link href="/precios">Planes</Link>
          <Link href="/demo">Demo</Link>
          <Link href="/integraciones">Integraciones</Link>
        </nav>

        <div className={styles.navActions}>
          <Link href="/login" className={styles.secondaryButton}>Iniciar sesión</Link>
          <Link href="/demo" className={styles.primaryButton}>Solicitar demo</Link>
          <details className={styles.mobileMenu}>
            <summary aria-label="Abrir navegación">
              <span aria-hidden="true">☰</span>
            </summary>
            <nav className={styles.mobileLinks} aria-label="Menú móvil">
              <Link href="/inicio">Inicio</Link>
              <Link href="/inicio#por-que">¿Por qué MW1?</Link>
              <Link href="/precios">Planes</Link>
              <Link href="/demo">Demo</Link>
              <Link href="/integraciones">Integraciones</Link>
              <Link href="/login">Iniciar sesión</Link>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}

export function HeroMedia() {
  return (
    <div className={styles.heroMedia} aria-label="Vista de ejemplo de la plataforma MW1">
      <div className={styles.heroApp}>
        <div className={styles.heroAppTop}>
          <span className={styles.appMiniLogo}>M</span>
          <strong>MW1</strong>
          <span className={styles.heroAppSubtitle}>Atención centralizada</span>
          <span className={styles.appLive}><i aria-hidden="true" />En línea</span>
        </div>
        <div className={styles.heroAppBody}>
          <div className={styles.heroAppInbox}>
            <span className={styles.previewSmallLabel}>BANDEJA DE ENTRADA</span>
            <strong>Conversaciones</strong>
            <div className={styles.appConversationSelected}>
              <span className={styles.appPersonAvatar}>M</span>
              <span><b>María González</b><small>Consulta sobre planes</small></span>
              <span className={styles.appUnread}>2</span>
            </div>
            <div className={styles.appConversation}>
              <span className={styles.appPersonAvatar}>C</span>
              <span><b>Carlos Ramírez</b><small>Información de servicios</small></span>
            </div>
            <div className={styles.appConversation}>
              <span className={styles.appPersonAvatar}>L</span>
              <span><b>Laura Torres</b><small>Seguimiento comercial</small></span>
            </div>
          </div>
          <div className={styles.heroAppChat}>
            <div className={styles.appChatTitle}>
              <span className={styles.appPersonAvatar}>M</span>
              <span><b>María González</b><small>WhatsApp · Cliente potencial</small></span>
            </div>
            <div className={styles.appMessageClient}>
              Hola, quisiera conocer cómo funciona MW1 para mi empresa.
            </div>
            <div className={styles.appMessageBusiness}>
              ¡Hola, María! Podemos ayudarte a organizar conversaciones, clientes y seguimientos desde un solo lugar.
            </div>
            <div className={styles.appAssist}>
              <span aria-hidden="true">✦</span>
              <span><strong>IA como apoyo</strong><small>Respuestas y contexto disponibles para tu equipo</small></span>
            </div>
          </div>
        </div>
        <div className={styles.heroAppFoot}>
          <span><span className={styles.appFooterDot} /> Equipo conectado</span>
          <span>Vista ilustrativa · Datos de ejemplo</span>
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
