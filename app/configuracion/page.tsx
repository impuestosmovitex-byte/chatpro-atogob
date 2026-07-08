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

type ChecklistItem = {
  key: string;
  title: string;
  description: string;
  status: 'ready' | 'pending' | 'warning';
  actionLabel: string;
  href: string;
};

type ChecklistResponse = {
  ok?: boolean;
  error?: string;
  company?: {
    name?: string;
  };
  summary?: {
    ready: number;
    blocking: number;
    warning: number;
    total: number;
    percent: number;
    canActivateRealCompany: boolean;
  };
  items?: ChecklistItem[];
};

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

function statusLabel(status: ChecklistItem['status']) {
  if (status === 'ready') return 'Listo';
  if (status === 'warning') return 'Revisar';
  return 'Falta';
}

export default function ConfiguracionPage() {
  const [companyName, setCompanyName] = useState('Empresa');
  const [checklist, setChecklist] = useState<ChecklistResponse | null>(null);
  const [checklistError, setChecklistError] = useState('');
  const [loadingChecklist, setLoadingChecklist] = useState(true);

  useEffect(() => {
    async function loadSession() {
      try {
        const response = await fetch('/api/auth/session', {
          cache: 'no-store',
        });
        const data = (await response.json()) as SessionResponse;

        if (response.ok && data.ok && data.session?.companyName) {
          setCompanyName(data.session.companyName);
        }
      } catch {
        setCompanyName('Empresa');
      }
    }

    async function loadChecklist() {
      setLoadingChecklist(true);

      try {
        const response = await fetch('/api/activation-checklist', {
          cache: 'no-store',
        });
        const data = (await response.json()) as ChecklistResponse;

        if (!response.ok || !data.ok) {
          throw new Error(data.error || 'No se pudo cargar el checklist.');
        }

        if (data.company?.name) {
          setCompanyName(data.company.name);
        }

        setChecklist(data);
        setChecklistError('');
      } catch (error) {
        setChecklistError(
          error instanceof Error
            ? error.message
            : 'No se pudo cargar el checklist.',
        );
      } finally {
        setLoadingChecklist(false);
      }
    }

    void loadSession();
    void loadChecklist();
  }, []);

  const summary = checklist?.summary;
  const checklistItems = checklist?.items ?? [];

  return (
    <main className={styles.shell}>
      <AppSidebar companyName={companyName} />

      <section className={styles.workspace}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>CONFIGURACIÓN</p>
            <h1>Configura {companyName}</h1>
            <p>
              Administra los ajustes de tu empresa, equipo, canales y atención.
            </p>
          </div>
        </header>

        <section className={styles.activation}>
          <div className={styles.activationHeader}>
            <div>
              <p className={styles.eyebrow}>ACTIVACIÓN DE EMPRESA</p>
              <h2>Estado para conectar una empresa real</h2>
              <p>
                Revisa qué está listo y qué falta antes de activar WhatsApp real,
                IA comercial y atención con asesores.
              </p>
            </div>

            <div className={styles.score}>
              <strong>
                {summary ? `${summary.percent}%` : loadingChecklist ? '…' : '0%'}
              </strong>
              <span>
                {summary
                  ? `${summary.ready}/${summary.total} listo`
                  : 'Cargando'}
              </span>
            </div>
          </div>

          {checklistError ? (
            <p className={styles.checklistError}>{checklistError}</p>
          ) : null}

          {summary ? (
            <div
              className={`${styles.activationStatus} ${
                summary.canActivateRealCompany
                  ? styles.activationReady
                  : styles.activationPending
              }`}
            >
              {summary.canActivateRealCompany ? (
                <strong>La base está lista para prueba con empresa real.</strong>
              ) : (
                <strong>Faltan pasos antes de activar una empresa real.</strong>
              )}
              <span>
                {summary.blocking} obligatorios pendientes · {summary.warning}{' '}
                recomendaciones por revisar.
              </span>
            </div>
          ) : null}

          <div className={styles.checklistGrid}>
            {loadingChecklist && !checklistItems.length ? (
              <div className={styles.checklistLoading}>
                Cargando checklist de activación…
              </div>
            ) : (
              checklistItems.map((item) => (
                <article className={styles.checkItem} key={item.key}>
                  <span
                    className={`${styles.checkBadge} ${
                      styles[`check_${item.status}`]
                    }`}
                  >
                    {statusLabel(item.status)}
                  </span>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                  <button
                    type="button"
                    onClick={() => window.location.assign(item.href)}
                  >
                    {item.actionLabel}
                  </button>
                </article>
              ))
            )}
          </div>
        </section>

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
