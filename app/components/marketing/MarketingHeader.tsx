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

export function ChannelCloud() {
  const channels = [
    { name: "WhatsApp", short: "WA", tone: "green" },
    { name: "Instagram", short: "IG", tone: "pink" },
    { name: "Messenger", short: "MS", tone: "blue" },
    { name: "Telegram", short: "TG", tone: "sky" },
    { name: "Chat web", short: "WEB", tone: "ink" },
  ];

  return (
    <div className={styles.channelCloud} aria-label="Canales disponibles">
      <div className={styles.channelOrbit} />
      {channels.map((channel, index) => (
        <div
          key={channel.name}
          className={`${styles.channelBubble} ${styles[`channel${index + 1}`]}`}
        >
          <span className={`${styles.channelIcon} ${styles[channel.tone]}`}>
            {channel.short}
          </span>
          <span>{channel.name}</span>
        </div>
      ))}

      <div className={`${styles.chatFloat} ${styles.chatFloatOne}`}>
        <span className={styles.avatar}>CL</span>
        <div>
          <strong>Quiero información</strong>
          <small>¿Me ayudan con mi pedido?</small>
        </div>
      </div>

      <div className={`${styles.chatFloat} ${styles.chatFloatTwo}`}>
        <span className={styles.botAvatar}>IA</span>
        <div>
          <strong>Respuesta inmediata</strong>
          <small>Claro. Te ayudo ahora mismo.</small>
        </div>
      </div>

      <div className={styles.heroPerson} aria-hidden="true">
        <div className={styles.personHair} />
        <div className={styles.personFace} />
        <div className={styles.personBody} />
        <div className={styles.personPhone}>MW1</div>
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
