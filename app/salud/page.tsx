"use client";

import { useEffect, useMemo, useState } from "react";
import { AppSidebar } from "../components/AppSidebar";
import styles from "./page.module.css";

type HealthStatus = "healthy" | "warning" | "critical";

type HealthCheck = {
  component: string;
  label: string;
  status: HealthStatus;
  summary: string;
  detail: string;
  latencyMs: number | null;
  checkedAt: string;
  metadata: Record<string, unknown>;
};

type HealthIncident = {
  id: string;
  component: string;
  label: string;
  status: HealthStatus;
  title: string;
  detail: string;
  startedAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  resolutionDetail: string | null;
};

type HealthResponse = {
  ok?: boolean;
  error?: string;
  company?: { id: string; slug: string; name: string };
  checkedAt?: string;
  checks?: HealthCheck[];
  incidents?: HealthIncident[];
};

const statusLabel: Record<HealthStatus, string> = {
  healthy: "Operando",
  warning: "Revisar",
  critical: "Falla crítica",
};

const statusOrder: Record<HealthStatus, number> = {
  critical: 0,
  warning: 1,
  healthy: 2,
};

function formatDate(value?: string | null) {
  if (!value) return "Sin registro";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "Sin registro";

  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function elapsed(value?: string | null) {
  if (!value) return "";

  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) return "";

  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));

  if (minutes < 1) return "ahora";
  if (minutes < 60) return `hace ${minutes} min`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;

  return `hace ${Math.round(hours / 24)} d`;
}

export default function HealthPage() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  async function load(refresh: boolean) {
    if (refresh) setRefreshing(true);
    setError("");

    try {
      const response = await fetch(
        `/api/platform-health?refresh=${refresh ? "1" : "0"}`,
        { cache: "no-store" },
      );
      const result = (await response.json()) as HealthResponse;

      if (!response.ok || !result.ok) {
        throw new Error(result.error || "No se pudo revisar la plataforma.");
      }

      setData(result);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No se pudo revisar la plataforma.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load(true);

    const timer = window.setInterval(() => {
      void load(false);
    }, 60000);

    return () => window.clearInterval(timer);
  }, []);

  const webCheck: HealthCheck = {
    component: "web",
    label: "Web ChatPro",
    status: "healthy",
    summary: "Página activa",
    detail: "La aplicación web está cargando correctamente.",
    latencyMs: null,
    checkedAt: new Date().toISOString(),
    metadata: {},
  };

  const checks = useMemo(
    () =>
      [webCheck, ...(data?.checks ?? [])].sort(
        (a, b) =>
          statusOrder[a.status] - statusOrder[b.status] ||
          a.label.localeCompare(b.label),
      ),
    [data],
  );

  const summary = useMemo(
    () => ({
      healthy: checks.filter((item) => item.status === "healthy").length,
      warning: checks.filter((item) => item.status === "warning").length,
      critical: checks.filter((item) => item.status === "critical").length,
    }),
    [checks],
  );

  const openIncidents = (data?.incidents ?? []).filter(
    (incident) => !incident.resolvedAt,
  );
  const critical = checks.filter((item) => item.status === "critical");

  return (
    <main className="chatpro-shell">
      <AppSidebar companyName={data?.company?.name ?? "Empresa"} />

      <section className={`workspace ${styles.workspace}`}>
        <header className={styles.header}>
          <div>
            <p className="eyebrow">Control técnico</p>
            <h1>Salud y alertas</h1>
            <p className={styles.subtitle}>
              Supervisa ChatPro, conexiones y automatizaciones sin entrar a
              las cuentas de los asesores.
            </p>
          </div>

          <button
            className={styles.refreshButton}
            type="button"
            onClick={() => void load(true)}
            disabled={refreshing}
          >
            {refreshing ? "Revisando…" : "Revisar ahora"}
          </button>
        </header>

        {error ? (
          <div className={styles.apiError}>
            <strong>La API no respondió correctamente.</strong>
            <span>{error}</span>
          </div>
        ) : null}

        {critical.length ? (
          <div className={styles.criticalBanner}>
            <strong>
              {critical.length} falla{critical.length === 1 ? "" : "s"} crítica
              {critical.length === 1 ? "" : "s"}
            </strong>
            <span>
              {critical.map((item) => item.label).join(", ")} requiere
              atención.
            </span>
          </div>
        ) : null}

        <section className={styles.summaryGrid}>
          <article>
            <span className={styles.healthyDot} />
            <div>
              <strong>{summary.healthy}</strong>
              <small>Operando</small>
            </div>
          </article>
          <article>
            <span className={styles.warningDot} />
            <div>
              <strong>{summary.warning}</strong>
              <small>Por revisar</small>
            </div>
          </article>
          <article>
            <span className={styles.criticalDot} />
            <div>
              <strong>{summary.critical}</strong>
              <small>Críticas</small>
            </div>
          </article>
          <article>
            <div>
              <strong>{openIncidents.length}</strong>
              <small>Alertas abiertas</small>
            </div>
          </article>
        </section>

        <div className={styles.sectionHeading}>
          <div>
            <p className="eyebrow">Estado actual</p>
            <h2>Servicios de la plataforma</h2>
          </div>
          <small>
            Última revisión: {formatDate(data?.checkedAt)}{" "}
            {data?.checkedAt ? `· ${elapsed(data.checkedAt)}` : ""}
          </small>
        </div>

        <section className={styles.checkGrid}>
          {loading && !data ? (
            <div className={styles.loadingCard}>Revisando servicios…</div>
          ) : (
            checks.map((check) => (
              <article
                className={`${styles.checkCard} ${styles[check.status]}`}
                key={check.component}
              >
                <header>
                  <span className={styles.statusDot} />
                  <div>
                    <h3>{check.label}</h3>
                    <small>{statusLabel[check.status]}</small>
                  </div>
                </header>

                <strong>{check.summary}</strong>
                <p>{check.detail}</p>

                <footer>
                  <span>{elapsed(check.checkedAt)}</span>
                  {check.latencyMs !== null ? (
                    <span>{check.latencyMs} ms</span>
                  ) : null}
                </footer>
              </article>
            ))
          )}
        </section>

        <div className={styles.sectionHeading}>
          <div>
            <p className="eyebrow">Historial</p>
            <h2>Caídas y recuperaciones</h2>
          </div>
          <small>Se conservan las últimas 40 alertas.</small>
        </div>

        <section className={styles.incidentPanel}>
          {(data?.incidents ?? []).length ? (
            <div className={styles.incidentList}>
              {(data?.incidents ?? []).map((incident) => (
                <article key={incident.id}>
                  <span
                    className={`${styles.incidentBadge} ${
                      incident.resolvedAt
                        ? styles.resolved
                        : styles[incident.status]
                    }`}
                  >
                    {incident.resolvedAt
                      ? "Recuperado"
                      : statusLabel[incident.status]}
                  </span>
                  <div>
                    <strong>{incident.label}</strong>
                    <h3>{incident.title}</h3>
                    <p>{incident.detail}</p>
                  </div>
                  <div className={styles.incidentDates}>
                    <span>Inicio: {formatDate(incident.startedAt)}</span>
                    <span>
                      {incident.resolvedAt
                        ? `Recuperado: ${formatDate(incident.resolvedAt)}`
                        : `Última detección: ${formatDate(
                            incident.lastSeenAt,
                          )}`}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>
              Todavía no hay fallas registradas.
            </div>
          )}
        </section>

        <p className={styles.note}>
          La revisión automática se ejecuta cada 5 minutos. Cuando una conexión
          falla se abre una alerta; cuando vuelve a funcionar, ChatPro registra
          automáticamente la recuperación.
        </p>
      </section>
    </main>
  );
}
