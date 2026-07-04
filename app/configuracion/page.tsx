 'use client';

import { AppSidebar } from '../components/AppSidebar';
import styles from './page.module.css';

const COMPANY_NAME =
  (process.env.NEXT_PUBLIC_CHATPRO_COMPANY || 'ATOGOB').toUpperCase();

const cards = [
  {
    title: 'IA y ventas',
    description:
      'Define la asesora, tono, instrucciones comerciales y reglas de atención.',
    icon: '✦',
    href: '/configuracion/ia',
    available: true,
  },
  {
    title: 'Respuestas rápidas',
    description: 'Crea atajos con / para que el equipo responda más rápido en la bandeja.',
    icon: '↗',
    href: '/configuracion/respuestas-rapidas',
    available: true,
  },
  {
    title: 'Empresa e identidad',
    description:
      'Nombre, logo, datos comerciales y apariencia del espacio de trabajo.',
    icon: '◌',
    href: '/configuracion/empresa-identidad',
    available: true,
  },
  {
    title: 'Canales e integraciones',
    description:
      'WhatsApp, Instagram, Messenger, Shopify y otros canales conectados.',
    icon: '◔',
    href: '/configuracion/integraciones',
    available: true,
  },
  {
    title: 'Áreas de atención',
    description:
      'Crea las áreas de tu empresa para organizar y repartir conversaciones.',
    icon: '◫',
    href: '/configuracion/areas-atencion',
    available: true,
  },
  {
    title: 'Horarios y atención',
    description:
      'Horarios comerciales, mensajes fuera de horario y reglas de asignación.',
    icon: '◷',
    href: '/configuracion/horarios-atencion',
    available: true,
  },
  {
    title: 'Usuarios',
    description:
      'Crea usuarios, asigna áreas de atención y administra roles y permisos.',
    icon: '◉',
    href: '/usuarios',
    available: true,
  },
];

export default function ConfiguracionPage() {
  return (
    <main className={styles.shell}>
      <AppSidebar companyName={COMPANY_NAME} />

      <section className={styles.workspace}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>CONFIGURACIÓN</p>
            <h1>Configura {COMPANY_NAME}</h1>
            <p>
              Administra los ajustes de tu empresa, equipo, canales y atención.
            </p>
          </div>
        </header>

        <section className={styles.grid} aria-label="Opciones de configuración">
          {cards.map((card) => (
            <article
              className={`${styles.card} ${
                card.available ? '' : styles.disabledCard
              }`}
              key={card.title}
            >
              <span className={styles.icon}>{card.icon}</span>
              <div>
                <h2>{card.title}</h2>
                <p>{card.description}</p>
              </div>

              {card.available && card.href ? (
                <button
                  type="button"
                  className={styles.openButton}
                  onClick={() => window.location.assign(card.href!)}
                >
                  Abrir
                </button>
              ) : (
                <span className={styles.soon}>Próximamente</span>
              )}
            </article>
          ))}
        </section>
      </section>
    </main>
  );
}
