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
  preparedOnly: boolean;
  preparedMessage: string | null;
  testSendAllowed: boolean;
  orderNumber: string | null;
  sourceTopic: string | null;
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
  abandonedCartSchedule?: Array<{
    sequence: number;
    delayMinutes: number;
  }>;
  automation?: Automation;
  testSafety?: {
    enabled: boolean;
    allowedPhones: string[];
  };
};

const statusLabels: Record<string, string> = {
  pending: 'Pendiente',
  running: 'Procesando',
  sent: 'Enviado',
  failed: 'Fallido',
  cancelled: 'Cancelado',
  skipped: 'Omitido',
};

function delayLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes % 60 === 0) return `${minutes / 60} h`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function cartStepLabel(sequence: number): string {
  if (sequence === 1) return 'Primer recordatorio';
  if (sequence === 2) return 'Segundo recordatorio';
  if (sequence === 3) return 'Bono final';
  return `Mensaje ${sequence}`;
}

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
  const [abandonedCartSchedule, setAbandonedCartSchedule] = useState<
    Array<{ sequence: number; delayMinutes: number }>
  >([]);
  const [summary, setSummary] = useState({
    enabled: 0,
    sent: 0,
    failed: 0,
    pending: 0,
  });
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState('');
  const [sendingExecutionId, setSendingExecutionId] = useState('');
  const [testPhones, setTestPhones] = useState<string[]>([]);
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
      setAbandonedCartSchedule(data.abandonedCartSchedule || []);
      setTestPhones(data.testSafety?.allowedPhones || []);
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

  async function sendTest(execution: Execution) {
    setSendingExecutionId(execution.id);
    setMessage('');
    setError('');

    try {
      const response = await fetch('/api/automations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'send-test',
          executionId: execution.id,
        }),
      });
      const data = (await response.json()) as ResponseData;

      if (!response.ok || !data.ok) {
        throw new Error(
          data.error || 'No se pudo enviar la prueba.',
        );
      }

      setMessage(data.message || 'Mensaje de prueba enviado.');
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'No se pudo enviar la prueba.',
      );
    } finally {
      setSendingExecutionId('');
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
              Activa cada flujo y revisa todo lo que ChatPro intenta
              enviar.
            </p>
          </div>

          <button
            type="button"
            className={styles.messageSettings}
            onClick={() =>
              window.location.assign('/automatizaciones/mensajes')
            }
          >
            Configurar mensajes
          </button>
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
            automations
              .filter(
                (automation) =>
                  automation.key !== 'payment_confirmed',
              )
              .map((automation) => (
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

                <div className={styles.operation}>
                  <strong>Funcionamiento 24/7</strong>
                  <p>
                    {automation.key === 'abandoned_cart'
                      ? 'Se envía según los tiempos configurados después de detectar el abandono.'
                      : automation.key === 'order_created'
                        ? 'Se enviará inmediatamente cuando Shopify cree el pedido.'
                        : 'Se enviará inmediatamente cuando Shopify genere la guía o el envío.'}
                  </p>

                  {automation.key === 'abandoned_cart' ? (
                    <div className={styles.schedule}>
                      {abandonedCartSchedule.map((rule) => (
                        <span
                          className={styles.scheduleChip}
                          key={rule.sequence}
                        >
                          {cartStepLabel(rule.sequence)}:{' '}
                          {delayLabel(rule.delayMinutes)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>

                <p className={styles.technicalNote}>
                  Los reintentos por errores se administran automáticamente.
                </p>

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

        <div className={styles.testSafety}>
          <strong>Modo de prueba protegido</strong>
          <span>
            {testPhones.length
              ? `Solo se permite enviar a: ${testPhones.join(', ')}`
              : 'No hay teléfonos autorizados. Configúralos en Configuración → IA.'}
          </span>
        </div>

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
                      <td>
                        {execution.automationKey}
                        {execution.orderNumber
                          ? ` · ${execution.orderNumber}`
                          : ''}
                      </td>
                      <td>{execution.recipient || '—'}</td>
                      <td>
                        <span
                          className={`${styles.status} ${
                            styles[`status_${execution.status}`] || ''
                          }`}
                        >
                          {execution.preparedOnly
                            ? 'Preparado · sin envío'
                            : statusLabels[execution.status] ||
                              execution.status}
                        </span>
                      </td>
                      <td>{execution.attemptCount}</td>
                      <td>
                        {execution.preparedMessage ? (
                          <div className={styles.preparedActions}>
                            <details className={styles.preparedMessage}>
                              <summary>Ver mensaje preparado</summary>
                              <pre>{execution.preparedMessage}</pre>
                            </details>

                            {execution.testSendAllowed ? (
                              <button
                                type="button"
                                className={styles.testSendButton}
                                disabled={
                                  sendingExecutionId === execution.id
                                }
                                onClick={() => void sendTest(execution)}
                              >
                                {sendingExecutionId === execution.id
                                  ? 'Enviando prueba…'
                                  : 'Enviar prueba'}
                              </button>
                            ) : execution.status !== 'sent' ? (
                              <small className={styles.testBlocked}>
                                Número no autorizado para pruebas
                              </small>
                            ) : null}
                          </div>
                        ) : (
                          execution.error ||
                          (execution.sentAt
                            ? `Enviado ${dateTime(execution.sentAt)}`
                            : execution.nextRetryAt
                              ? `Reintento ${dateTime(
                                  execution.nextRetryAt,
                                )}`
                              : '—')
                        )}
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
