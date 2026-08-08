'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { AppSidebar } from '../components/AppSidebar';
import styles from './page.module.css';

type Summary = {
  conversationsWithActivity: number;
  customerMessages: number;
  aiMessages: number;
  advisorMessages: number;
  handoffsRequested: number;
  handoffsAssigned: number;
  checkoutsCreated: number;
  conversationsClosed: number;
  conversationsResumedAi: number;
  paymentProofs: number;
  ordersCreated: number;
  paymentsPending: number;
  ordersPaid: number;
  unansweredNow: number;
};

type UnansweredAge = {
  under5Minutes: number;
  minutes5To15: number;
  minutes15To30: number;
  minutes30To60: number;
  over1Hour: number;
};

type ChannelRow = {
  channel: string;
  events: number;
};

type AdvisorRow = {
  advisorUserId: string | null;
  advisorName: string | null;
  messages: number;
  assignments: number;
};

type AreaRow = {
  serviceAreaId: string | null;
  serviceAreaName: string | null;
  events: number;
};

type TimelineRow = {
  bucket: string;
  customerMessages: number;
  aiMessages: number;
  advisorMessages: number;
  checkouts: number;
  handoffs: number;
};

type StatisticsData = {
  from: string;
  to: string;
  timezone: string;
  bucket: 'hour' | 'day';
  summary: Summary;
  unansweredAge: UnansweredAge;
  channels: ChannelRow[];
  advisors: AdvisorRow[];
  areas: AreaRow[];
  timeline: TimelineRow[];
};

type StatisticsResponse = {
  ok?: boolean;
  error?: string;
  statistics?: StatisticsData;
};

type SessionResponse = {
  session?: {
    companyName?: string;
  };
};

function two(value: number) {
  return String(value).padStart(2, '0');
}

function todayParts() {
  const now = new Date();

  return {
    date: `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`,
    time: `${two(now.getHours())}:${two(now.getMinutes())}`,
  };
}

function localToIso(date: string, time: string) {
  const parsed = new Date(`${date}T${time}:00`);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error('La fecha u hora no es válida.');
  }

  return parsed.toISOString();
}

function number(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function channelLabel(value: string) {
  if (value === 'whatsapp') return 'WhatsApp';
  if (value === 'instagram') return 'Instagram';
  if (value === 'messenger') return 'Messenger';
  if (value === 'manual') return 'Manual';
  return value || 'Sin canal';
}

function bucketLabel(value: string, bucket: 'hour' | 'day') {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  if (bucket === 'day') {
    return new Intl.DateTimeFormat('es-CO', {
      day: '2-digit',
      month: 'short',
    }).format(date);
  }

  return new Intl.DateTimeFormat('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export default function EstadisticasPage() {
  const initial = useMemo(() => todayParts(), []);

  const [companyName, setCompanyName] = useState('Empresa');
  const [fromDate, setFromDate] = useState(initial.date);
  const [fromTime, setFromTime] = useState('00:00');
  const [toDate, setToDate] = useState(initial.date);
  const [toTime, setToTime] = useState(initial.time);
  const [bucket, setBucket] = useState<'hour' | 'day'>('hour');
  const [timezone] = useState('America/Bogota');

  const [data, setData] = useState<StatisticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadStatistics() {
    setLoading(true);
    setError('');

    try {
      const from = localToIso(fromDate, fromTime);
      const to = localToIso(toDate, toTime);

      if (new Date(from) >= new Date(to)) {
        throw new Error('La fecha inicial debe ser menor que la fecha final.');
      }

      const params = new URLSearchParams({
        from,
        to,
        timezone,
        bucket,
      });

      const response = await fetch(`/api/statistics?${params.toString()}`, {
        cache: 'no-store',
      });

      const result = (await response.json()) as StatisticsResponse;

      if (!response.ok || !result.ok || !result.statistics) {
        throw new Error(
          result.error || 'No se pudieron cargar las estadísticas.',
        );
      }

      setData(result.statistics);
    } catch (caught) {
      setData(null);
      setError(
        caught instanceof Error
          ? caught.message
          : 'No se pudieron cargar las estadísticas.',
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadSession() {
    try {
      const response = await fetch('/api/auth/session', {
        cache: 'no-store',
      });

      const result = (await response.json()) as SessionResponse;

      if (response.ok && result.session?.companyName) {
        setCompanyName(result.session.companyName);
      }
    } catch {
      // La página puede seguir funcionando sin el nombre.
    }
  }

  useEffect(() => {
    void loadSession();
    void loadStatistics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadStatistics();
  }

  function setToday() {
    const now = todayParts();

    setFromDate(now.date);
    setFromTime('00:00');
    setToDate(now.date);
    setToTime(now.time);
    setBucket('hour');

    window.setTimeout(() => {
      const from = localToIso(now.date, '00:00');
      const to = localToIso(now.date, now.time);

      const params = new URLSearchParams({
        from,
        to,
        timezone,
        bucket: 'hour',
      });

      setLoading(true);
      setError('');

      void fetch(`/api/statistics?${params.toString()}`, {
        cache: 'no-store',
      })
        .then(async (response) => {
          const result = (await response.json()) as StatisticsResponse;

          if (!response.ok || !result.ok || !result.statistics) {
            throw new Error(
              result.error || 'No se pudieron cargar las estadísticas.',
            );
          }

          setData(result.statistics);
        })
        .catch((caught) => {
          setData(null);
          setError(
            caught instanceof Error
              ? caught.message
              : 'No se pudieron cargar las estadísticas.',
          );
        })
        .finally(() => setLoading(false));
    }, 0);
  }

  const summary = data?.summary;

  const maxTimeline = Math.max(
    1,
    ...(data?.timeline ?? []).map((item) =>
      Math.max(
        number(item.customerMessages),
        number(item.aiMessages),
        number(item.advisorMessages),
      ),
    ),
  );

  return (
    <main className="chatpro-shell">
      <AppSidebar companyName={companyName} />

      <section className={`workspace ${styles.workspace}`}>
        <header className={styles.header}>
          <div>
            <p className="eyebrow">CONTROL OPERATIVO Y COMERCIAL</p>
            <h1>Estadísticas · {companyName}</h1>
            <p className={styles.subtitle}>
              Revisa atención, IA, asesores, transferencias, checkout y
              conversaciones pendientes.
            </p>
          </div>

          <button
            className={styles.refreshButton}
            type="button"
            onClick={() => void loadStatistics()}
            disabled={loading}
          >
            {loading ? 'Actualizando…' : 'Actualizar'}
          </button>
        </header>

        <form className={styles.filters} onSubmit={applyFilters}>
          <label>
            <span>Desde</span>
            <div className={styles.dateTime}>
              <input
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
              />
              <input
                type="time"
                value={fromTime}
                onChange={(event) => setFromTime(event.target.value)}
              />
            </div>
          </label>

          <label>
            <span>Hasta</span>
            <div className={styles.dateTime}>
              <input
                type="date"
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
              />
              <input
                type="time"
                value={toTime}
                onChange={(event) => setToTime(event.target.value)}
              />
            </div>
          </label>

          <label>
            <span>Agrupar</span>
            <select
              value={bucket}
              onChange={(event) =>
                setBucket(event.target.value === 'day' ? 'day' : 'hour')
              }
            >
              <option value="hour">Por hora</option>
              <option value="day">Por día</option>
            </select>
          </label>

          <div className={styles.filterActions}>
            <button type="submit" disabled={loading}>
              {loading ? 'Consultando…' : 'Aplicar'}
            </button>

            <button
              type="button"
              className={styles.secondaryButton}
              onClick={setToday}
              disabled={loading}
            >
              Hoy
            </button>
          </div>
        </form>

        <div className={styles.timezone}>
          Zona horaria: <strong>{timezone}</strong>
        </div>

        {error ? (
          <div className={styles.apiError}>
            <strong>No se pudieron cargar las estadísticas.</strong>
            <span>{error}</span>
          </div>
        ) : null}

        <section className={styles.summaryGrid}>
          <article>
            <span>Conversaciones</span>
            <strong>{number(summary?.conversationsWithActivity)}</strong>
            <small>con actividad</small>
          </article>

          <article>
            <span>Mensajes recibidos</span>
            <strong>{number(summary?.customerMessages)}</strong>
            <small>del cliente</small>
          </article>

          <article>
            <span>Respondidos por IA</span>
            <strong>{number(summary?.aiMessages)}</strong>
            <small>mensajes IA</small>
          </article>

          <article>
            <span>Respondidos por asesor</span>
            <strong>{number(summary?.advisorMessages)}</strong>
            <small>mensajes humanos</small>
          </article>

          <article>
            <span>Transferencias</span>
            <strong>{number(summary?.handoffsRequested)}</strong>
            <small>{number(summary?.handoffsAssigned)} asignadas</small>
          </article>

          <article>
            <span>Checkout</span>
            <strong>{number(summary?.checkoutsCreated)}</strong>
            <small>enlaces generados</small>
          </article>

          <article>
            <span>Cerradas</span>
            <strong>{number(summary?.conversationsClosed)}</strong>
            <small>conversaciones</small>
          </article>

          <article className={styles.pendingCard}>
            <span>Sin responder ahora</span>
            <strong>{number(summary?.unansweredNow)}</strong>
            <small>requieren atención</small>
          </article>
        </section>

        <div className={styles.sectionHeading}>
          <div>
            <p className="eyebrow">PENDIENTES AHORA</p>
            <h2>Antigüedad sin respuesta</h2>
          </div>
        </div>

        <section className={styles.pendingGrid}>
          <article>
            <strong>{number(data?.unansweredAge?.under5Minutes)}</strong>
            <span>Menos de 5 min</span>
          </article>
          <article>
            <strong>{number(data?.unansweredAge?.minutes5To15)}</strong>
            <span>5 a 15 min</span>
          </article>
          <article>
            <strong>{number(data?.unansweredAge?.minutes15To30)}</strong>
            <span>15 a 30 min</span>
          </article>
          <article>
            <strong>{number(data?.unansweredAge?.minutes30To60)}</strong>
            <span>30 a 60 min</span>
          </article>
          <article>
            <strong>{number(data?.unansweredAge?.over1Hour)}</strong>
            <span>Más de 1 hora</span>
          </article>
        </section>

        <div className={styles.sectionHeading}>
          <div>
            <p className="eyebrow">ACTIVIDAD</p>
            <h2>{bucket === 'hour' ? 'Por hora' : 'Por día'}</h2>
          </div>
        </div>

        <section className={styles.timelinePanel}>
          {loading && !data ? (
            <div className={styles.empty}>Cargando actividad…</div>
          ) : !(data?.timeline?.length) ? (
            <div className={styles.empty}>
              No hay eventos registrados en este período.
            </div>
          ) : (
            data.timeline.map((item) => (
              <article className={styles.timelineRow} key={item.bucket}>
                <strong>{bucketLabel(item.bucket, data.bucket)}</strong>

                <div className={styles.timelineMetrics}>
                  <div>
                    <span>Cliente {number(item.customerMessages)}</span>
                    <i
                      style={{
                        width: `${Math.max(
                          2,
                          (number(item.customerMessages) / maxTimeline) * 100,
                        )}%`,
                      }}
                    />
                  </div>

                  <div>
                    <span>IA {number(item.aiMessages)}</span>
                    <i
                      style={{
                        width: `${Math.max(
                          2,
                          (number(item.aiMessages) / maxTimeline) * 100,
                        )}%`,
                      }}
                    />
                  </div>

                  <div>
                    <span>Asesor {number(item.advisorMessages)}</span>
                    <i
                      style={{
                        width: `${Math.max(
                          2,
                          (number(item.advisorMessages) / maxTimeline) * 100,
                        )}%`,
                      }}
                    />
                  </div>
                </div>

                <small>
                  {number(item.checkouts)} checkout · {number(item.handoffs)}{' '}
                  transferencias
                </small>
              </article>
            ))
          )}
        </section>

        <section className={styles.columns}>
          <div>
            <div className={styles.sectionHeading}>
              <div>
                <p className="eyebrow">ASESORES</p>
                <h2>Rendimiento</h2>
              </div>
            </div>

            <section className={styles.tableCard}>
              {data?.advisors?.length ? (
                data.advisors.map((advisor) => (
                  <article key={advisor.advisorUserId || advisor.advisorName}>
                    <div>
                      <strong>{advisor.advisorName || 'Asesor'}</strong>
                      <small>{number(advisor.assignments)} asignaciones</small>
                    </div>
                    <b>{number(advisor.messages)} mensajes</b>
                  </article>
                ))
              ) : (
                <div className={styles.empty}>Sin actividad de asesores.</div>
              )}
            </section>
          </div>

          <div>
            <div className={styles.sectionHeading}>
              <div>
                <p className="eyebrow">CANALES</p>
                <h2>Actividad por canal</h2>
              </div>
            </div>

            <section className={styles.tableCard}>
              {data?.channels?.length ? (
                data.channels.map((channel) => (
                  <article key={channel.channel}>
                    <strong>{channelLabel(channel.channel)}</strong>
                    <b>{number(channel.events)} eventos</b>
                  </article>
                ))
              ) : (
                <div className={styles.empty}>Sin actividad por canal.</div>
              )}
            </section>
          </div>
        </section>

        <div className={styles.sectionHeading}>
          <div>
            <p className="eyebrow">ÁREAS DE ATENCIÓN</p>
            <h2>Actividad por área</h2>
          </div>
        </div>

        <section className={styles.tableCard}>
          {data?.areas?.length ? (
            data.areas.map((area) => (
              <article key={area.serviceAreaId || area.serviceAreaName}>
                <strong>{area.serviceAreaName || 'Sin nombre'}</strong>
                <b>{number(area.events)} eventos</b>
              </article>
            ))
          ) : (
            <div className={styles.empty}>
              No hay actividad asociada a áreas en este período.
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
