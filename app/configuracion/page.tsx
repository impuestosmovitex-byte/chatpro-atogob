'use client';

import { useEffect, useState } from 'react';
import { AppSidebar } from '../components/AppSidebar';
import styles from './page.module.css';

type SessionResponse = {
  ok?: boolean;
  session?: {
    companyName?: string;
  };
};

const cards = [
  {
    title: 'Empresa e identidad',
    description:
      'Nombre, logo, datos comerciales y apariencia del espacio de trabajo.',
    icon: '◌',
    href: '/configuracion/empresa-identidad',
  },
  {
    title: 'Usuarios y roles',
    description:
      'Crea usuarios, organiza permisos y administra el acceso de tu equipo.',
    icon: '♙',
    href: '/usuarios',
  },
  {
    title: 'Áreas de atención',
    description:
      'Organiza las áreas de tu empresa para distribuir las conversaciones.',
    icon: '◫',
    href: '/configuracion/areas-atencion',
  },
  {
    title: 'Horarios y atención',
    description:
      'Configura horarios comerciales, disponibilidad y atención humana.',
    icon: '◷',
    href: '/configuracion/horarios-atencion',
  },
  {
    title: 'Canales e integraciones',
    description:
      'Administra WhatsApp, Instagram, Messenger, Shopify y otras integraciones.',
    icon: '◔',
    href: '/configuracion/integraciones',
  },
  {
    title: 'Salud y alertas',
    description:
      'Revisa conexiones, estado del sistema y alertas que requieren atención.',
    icon: '!',
    href: '/salud',
  },
];

export default function ConfiguracionPage() {
  const [companyName, setCompanyName] = useState('Empresa');

  useEffect(() => {
    let alive = true;

    async function loadSession() {
      try {
        const response = await fetch('/api/auth/session', {
          cache: 'no-store',
        });

        const data = (await response.json()) as SessionResponse;

        if (
          alive &&
          response.ok &&
          data.ok &&
          data.session?.companyName
        ) {
          setCompanyName(data.session.companyName);
        }
      } catch {
        if (alive) {
          setCompanyName('Empresa');
        }
      }
    }

    void loadSession();

    return () => {
      alive = false;
    };
  }, []);

  return (
    <main className={styles.shell}>
      <AppSidebar companyName={companyName} />

      <section className={styles.workspace}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>CONFIGURACIÓN</p>
            <h1>Configuración</h1>
            <p>
              <strong>{companyName}</strong> · Administra tu empresa, equipo,
              canales y atención.
            </p>
          </div>
        </header>

        <section
          className={styles.grid}
          aria-label="Opciones de configuración"
        >
          {cards.map((card) => (
            <article
              className={styles.card}
              key={card.title}
            >
              <span className={styles.icon}>
                {card.icon}
              </span>

              <div>
                <h2>{card.title}</h2>
                <p>{card.description}</p>
              </div>

              <button
                type="button"
                className={styles.openButton}
                onClick={() =>
                  window.location.assign(card.href)
                }
              >
                Abrir
              </button>
            </article>
          ))}
        </section>
      </section>
    </main>
  );
}
