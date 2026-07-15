'use client';

import { useEffect, useState } from 'react';
import { AppSidebar } from '../components/AppSidebar';
import styles from './page.module.css';

type Automation = {
  id: string;
  key:
    | 'abandoned_cart'
    | 'order_created'
    | 'payment_confirmed'
    | 'fulfillment_created';
  name: string;
  description: string;
  enabled: boolean;
  timezone: string;
  allowedDays: number[];
  sendWindowStart: string;
  sendWindowEnd: string;
  maxAttempts: number;
  retryDelayMinutes: number;
};

type Execution = {
  id: string;
  automationKey: string;
  recipient: string | null;
  status: string;
  attemptCount: number;
  nextRetryAt: string | null;
  sentAt: string | null;
  error: string | null;
  createdAt: string;
};

type ResponseData = {
  ok?: boolean;
  error?: string;
  message?: string;
  company?: { name?: string };
  automations?: Automation[];
  executions?: Execution[];
  summary?: {
    enabled: number;
    sent: number;
    failed: number;
    pending: number;
  };
  automation?: Automation;
};

const dayLabels = [
  { value: 1, label: 'L' },
  { value: 2, label: 'M' },
  { value: 3, label: 'X' },
  { value: 4, label: 'J' },
  { value: 5, label: 'V' },
  { value: 6, label: 'S' },
  { value: 0, label: 'D' },
];

const statusLabels: Record<string, string> = {
  pending: 'Pendiente',
  running: 'Procesando',
  sent: 'Enviado',
  failed: 'Fallido',
  cancelled: 'Cancelado',
  skipped: 'Omitido',
};

function dateTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

export default function AutomationsPage() {
  const [companyName, setCompanyName] = useState('Empresa');
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [summary, setSummary] = useState({
    enabled: 0,
    sent: 0,
    failed: 0,
    pending: 0,
  });
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/automations', {
        cache: 'no-store',
      });
      const data = (await response.json()) as ResponseData;

      if (!response.ok || !data.ok) {
        throw new Error(
          data.error || 'No se pudieron cargar las automatizaciones.',
        );
      }

      setCompanyName(data.company?.name || 'Empresa');
      setAutomations(data.automations || []);
      setExecutions(data.executions || []);
      setSummary(
        data.summary || {
          enabled: 0,
          sent: 0,
          failed: 0,
          pending: 0,
        },
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'No se pudieron cargar las automatizaciones.',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function change(
    key: Automation['key'],
    values: Partial<Automation>,
  ) {
    setAutomations((current) =>
      current.map((item) =>
        item.key === key ? { ...item, ...values } : item,
      ),
    );
  }

  function toggleDay(key: Automation['key'], day: number) {
    const automation = automations.find((item) => item.key === key);
    if (!automation) return;

    const allowedDays = automation.allowedDays.includes(day)
      ? automation.allowedDays.filter((item) => item !== day)
      : [...automation.allowedDays, day].sort((a, b) => a - b);

    if (!allowedDays.length) return;
    change(key, { allowedDays });
  }

  async function save(automation: Automation) {
    setSavingKey(automation.key);
    setMessage('');
    setError('');

    try {
      const response = await fetch('/api/automations', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          automationKey: automation.key,
          enabled: automation.enabled,
          timezone: automation.timezone,
          allowedDays: automation.allowedDays,
          sendWindowStart: automation.sendWindowStart,
          sendWindowEnd: automation.sendWindowEnd,
          maxAttempts: automation.maxAttempts,
          retryDelayMinutes: automation.retryDelayMinutes,
        }),
      });
      const data = (await response.json()) as ResponseData;

      if (!response.ok || !data.ok || !data.automation) {
        throw new Error(
          data.error || 'No se pudo guardar la automatización.',
        );
      }

      change(automation.key, data.automation);
      setMessage(data.message || 'Automatización guardada.');
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'No se pudo guardar la automatización.',
      );
    } finally {
      setSavingKey('');
    }
  }

  return (
    <main className={styles.shell}>
      <AppSidebar companyName={companyName} />

      <section className={styles.workspace}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>OPERACIÓN AUTOMÁTICA</p>
            <h1>Automatizaciones · {companyName}</h1>
            <p>
              Activa cada flujo, define horarios y revisa todo lo que
              ChatPro intenta enviar.
            </p>
          </div>
        </header>

        <section className={styles.metrics}>
          <article>
            <span>Activas</span>
            <strong>{summary.enabled}</strong>
          </article>
          <article>
            <span>Enviadas</span>
            <strong>{summary.sent}</strong>
          </article>
          <article>
            <span>Pendientes</span>
            <strong>{summary.pending}</strong>
          </article>
          <article>
            <span>Fallidas</span>
            <strong>{summary.failed}</strong>
          </article>
        </section>

        {error ? <p className={styles.error}>{error}</p> : null}
        {message ? <p className={styles.success}>{message}</p> : null}

        <section className={styles.cards}>
          {loading ? (
            <div className={styles.empty}>Cargando automatizaciones…</div>
          ) : (
            automations.map((automation) => (
              <article className={styles.card} key={automation.key}>
                <div className={styles.cardHeading}>
                  <div>
                    <p>{automation.description}</p>
                    <h2>{automation.name}</h2>
                  </div>
                  <label className={styles.switch}>
                    <input
                      type="checkbox"
                      checked={automation.enabled}
                      onChange={(event) =>
                        change(automation.key, {
                          enabled: event.target.checked,
                        })
                      }
                    />
                    <span>
                      {automation.enabled ? 'Activa' : 'Pausada'}
                    </span>
                  </label>
                </div>

                <div className={styles.days}>
                  {dayLabels.map((day) => (
                    <button
                      type="button"
                      key={day.value}
                      className={
                        automation.allowedDays.includes(day.value)
                          ? styles.dayActive
                          : ''
                      }
                      onClick={() =>
                        toggleDay(automation.key, day.value)
                      }
                    >
                      {day.label}
                    </button>
                  ))}
                </div>

                <div className={styles.grid}>
                  <label>
                    <span>Desde</span>
                    <input
                      type="time"
                      value={automation.sendWindowStart}
                      onChange={(event) =>
                        change(automation.key, {
                          sendWindowStart: event.target.value,
                        })
                      }
                    />
                  </label>

                  <label>
                    <span>Hasta</span>
                    <input
                      type="time"
                      value={automation.sendWindowEnd}
                      onChange={(event) =>
                        change(automation.key, {
                          sendWindowEnd: event.target.value,
                        })
                      }
                    />
                  </label>

                  <label>
                    <span>Reintentos máximos</span>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={automation.maxAttempts}
                      onChange={(event) =>
                        change(automation.key, {
                          maxAttempts:
                            Number(event.target.value) || 1,
                        })
                      }
                    />
                  </label>

                  <label>
                    <span>Reintentar después de</span>
                    <div className={styles.inlineInput}>
                      <input
                        type="number"
                        min={1}
                        max={1440}
                        value={automation.retryDelayMinutes}
                        onChange={(event) =>
                          change(automation.key, {
                            retryDelayMinutes:
                              Number(event.target.value) || 1,
                          })
                        }
                      />
                      <small>min</small>
                    </div>
                  </label>
                </div>

                <label className={styles.timezone}>
                  <span>Zona horaria</span>
                  <input
                    value={automation.timezone}
                    onChange={(event) =>
                      change(automation.key, {
                        timezone: event.target.value,
                      })
                    }
                  />
                </label>

                <button
                  type="button"
                  className={styles.save}
                  disabled={savingKey === automation.key}
                  onClick={() => void save(automation)}
                >
                  {savingKey === automation.key
                    ? 'Guardando…'
                    : 'Guardar automatización'}
                </button>
              </article>
            ))
          )}
        </section>

        <section className={styles.history}>
          <div className={styles.historyHeading}>
            <div>
              <p className={styles.eyebrow}>HISTORIAL</p>
              <h2>Últimas ejecuciones</h2>
            </div>
            <button type="button" onClick={() => void load()}>
              Actualizar
            </button>
          </div>

          {!executions.length ? (
            <div className={styles.empty}>
              Todavía no hay ejecuciones registradas.
            </div>
          ) : (
            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Automatización</th>
                    <th>Destino</th>
                    <th>Estado</th>
                    <th>Intentos</th>
                    <th>Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {executions.map((execution) => (
                    <tr key={execution.id}>
                      <td>{dateTime(execution.createdAt)}</td>
                      <td>{execution.automationKey}</td>
                      <td>{execution.recipient || '—'}</td>
                      <td>
                        <span
                          className={`${styles.status} ${
                            styles[`status_${execution.status}`] || ''
                          }`}
                        >
                          {statusLabels[execution.status] ||
                            execution.status}
                        </span>
                      </td>
                      <td>{execution.attemptCount}</td>
                      <td>
                        {execution.error ||
                          (execution.sentAt
                            ? `Enviado ${dateTime(execution.sentAt)}`
                            : execution.nextRetryAt
                              ? `Reintento ${dateTime(
                                  execution.nextRetryAt,
                                )}`
                              : '—')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
