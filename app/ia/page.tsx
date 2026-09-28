'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppSidebar } from '../components/AppSidebar';
import styles from './page.module.css';

type SettingsResponse = {
  ok?: boolean;
  error?: string;
  company?: {
    name?: string;
  };
  configuration?: {
    assistantName?: string;
    tone?: string;
    commercialFlow?: {
      salesInstructions?: string;
      serviceInstructions?: string;
    };
    knowledgeBase?: {
      termsConditions?: string;
      exchangesReturns?: string;
      warranties?: string;
      policiesFaq?: string;
    };
  };
};

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export default function AiPage() {
  const [companyName, setCompanyName] = useState('Empresa');
  const [settings, setSettings] =
    useState<SettingsResponse['configuration']>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [canTestAgent, setCanTestAgent] = useState(false);

  useEffect(() => {
    let alive = true;

    async function loadCapabilities() {
      try {
        const response = await fetch('/api/auth/capabilities', {
          cache: 'no-store',
        });

        const data = (await response.json()) as {
          ok?: boolean;
          capabilities?: {
            testAgent?: boolean;
          };
        };

        if (!alive) return;

        setCanTestAgent(
          response.ok &&
            data.ok === true &&
            data.capabilities?.testAgent === true,
        );
      } catch {
        if (alive) {
          setCanTestAgent(false);
        }
      }
    }

    void loadCapabilities();

    async function load() {
      try {
        const response = await fetch('/api/settings', {
          cache: 'no-store',
        });

        const data = (await response.json()) as SettingsResponse;

        if (!response.ok || !data.ok) {
          throw new Error(
            data.error || 'No se pudo cargar la configuración de IA.',
          );
        }

        if (!alive) return;

        setCompanyName(data.company?.name || 'Empresa');
        setSettings(data.configuration);
        setError('');
      } catch (caught) {
        if (!alive) return;

        setError(
          caught instanceof Error
            ? caught.message
            : 'No se pudo cargar la configuración de IA.',
        );
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      alive = false;
    };
  }, []);

  const assistantName =
    settings?.assistantName?.trim() || 'Asistente principal';

  const salesConfigured =
    hasText(settings?.commercialFlow?.salesInstructions);

  const serviceConfigured =
    hasText(settings?.commercialFlow?.serviceInstructions);

  const knowledgeConfigured = Boolean(
    hasText(settings?.knowledgeBase?.termsConditions) ||
      hasText(settings?.knowledgeBase?.exchangesReturns) ||
      hasText(settings?.knowledgeBase?.warranties) ||
      hasText(settings?.knowledgeBase?.policiesFaq),
  );

  return (
    <main className={styles.shell}>
      <AppSidebar companyName={companyName} />

      <section className={styles.workspace}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>IA</p>
            <h1>Asesores de IA</h1>
            <p>
              Configura cómo MW1 atiende, vende y ayuda a los clientes de{' '}
              <strong>{companyName}</strong>.
            </p>
          </div>
        </header>

        {error ? (
          <div className={styles.error}>
            {error}
          </div>
        ) : null}

        <section className={styles.assistantSection}>
          <div className={styles.sectionTitle}>
            <div>
              <p>ASISTENTE ACTUAL</p>
              <h2>Asistente principal</h2>
            </div>

            <span className={styles.countBadge}>
              1 configurado
            </span>
          </div>

          <article className={styles.assistantCard}>
            <div className={styles.assistantIcon} aria-hidden="true">
              ✦
            </div>

            <div className={styles.assistantInfo}>
              <div className={styles.assistantNameRow}>
                <h3>
                  {loading ? 'Cargando…' : assistantName}
                </h3>

                <span
                  className={
                    settings?.assistantName
                      ? styles.readyBadge
                      : styles.pendingBadge
                  }
                >
                  {settings?.assistantName
                    ? 'Configurado'
                    : 'Por configurar'}
                </span>
              </div>

              <p>
                Asistente principal de {companyName}. Ventas y
                servicio comparten identidad y configuración base.
              </p>

              {settings?.tone ? (
                <small>
                  Tono: {settings.tone}
                </small>
              ) : null}
            </div>

            <Link
              className={styles.primaryButton}
              href="/ia/configuracion#asistente"
            >
              Configurar asistente
            </Link>
          </article>
        </section>

        <section>
          <div className={styles.sectionTitle}>
            <div>
              <p>CAPACIDADES</p>
              <h2>Qué puede hacer tu asistente</h2>
            </div>
          </div>

          <div className={styles.capabilityGrid}>
            <article className={styles.capabilityCard}>
              <div className={styles.cardTop}>
                <span className={styles.cardIcon}>↗</span>
                <span
                  className={
                    salesConfigured
                      ? styles.readyBadge
                      : styles.pendingBadge
                  }
                >
                  {salesConfigured ? 'Configurado' : 'Revisar'}
                </span>
              </div>

              <h3>Ventas</h3>

              <p>
                Proceso de venta, envíos, pagos, checkout,
                recuperación y ofertas de cierre.
              </p>

              <Link href="/ia/configuracion#ventas-servicio">
                Configurar ventas →
              </Link>
            </article>

            <article className={styles.capabilityCard}>
              <div className={styles.cardTop}>
                <span className={styles.cardIcon}>◎</span>
                <span
                  className={
                    serviceConfigured
                      ? styles.readyBadge
                      : styles.pendingBadge
                  }
                >
                  {serviceConfigured ? 'Configurado' : 'Revisar'}
                </span>
              </div>

              <h3>Servicio al cliente</h3>

              <p>
                Pedidos, postventa, cambios, garantías,
                seguimiento y transferencia a asesores.
              </p>

              <Link href="/ia/configuracion#ventas-servicio">
                Configurar servicio →
              </Link>
            </article>

            <article className={styles.capabilityCard}>
              <div className={styles.cardTop}>
                <span className={styles.cardIcon}>▤</span>
                <span
                  className={
                    knowledgeConfigured
                      ? styles.readyBadge
                      : styles.pendingBadge
                  }
                >
                  {knowledgeConfigured ? 'Configurado' : 'Revisar'}
                </span>
              </div>

              <h3>Base de conocimiento</h3>

              <p>
                Términos, cambios, devoluciones, garantías,
                políticas y preguntas frecuentes.
              </p>

              <Link href="/ia/configuracion#base-conocimiento">
                Administrar conocimiento →
              </Link>
            </article>

            {canTestAgent ? (
              <article
                className={`${styles.capabilityCard} ${styles.testCard}`}
              >
                <div className={styles.cardTop}>
                  <span className={styles.cardIcon}>▷</span>
                  <span className={styles.testBadge}>
                    Prueba interna
                  </span>
                </div>

                <h3>Probar agente</h3>

                <p>
                  Conversa con la IA usando la configuración e
                  integraciones reales de esta empresa sin enviar
                  mensajes al exterior.
                </p>

                <Link
                  className={styles.testLink}
                  href="/?testAgent=1"
                >
                  Iniciar prueba →
                </Link>
              </article>
            ) : null}
          </div>
        </section>

        <div className={styles.note}>
          <strong>Arquitectura actual</strong>
          <span>
            MW1 utiliza por ahora un asistente principal por empresa.
            Ventas y Servicio al cliente pueden tener instrucciones
            distintas, pero comparten la identidad del asistente.
          </span>
        </div>
      </section>
    </main>
  );
}
