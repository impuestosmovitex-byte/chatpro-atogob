'use client';

import { useEffect, useState } from 'react';
import { AppSidebar } from '../../components/AppSidebar';
import styles from './page.module.css';

type DeliveryMode = 'session' | 'template';

type MessageConfig = {
  body: string;
  deliveryMode: DeliveryMode;
  templateName: string;
  templateLanguage: string;
};

type CartRule = MessageConfig & {
  sequence: number;
  delayMinutes: number;
  active: boolean;
};

type Configuration = {
  cartRules: CartRule[];
  orderCreated: MessageConfig;
  fulfillmentCreated: MessageConfig;
  variables: {
    abandonedCart: string[];
    orderCreated: string[];
    fulfillmentCreated: string[];
  };
  samples: Record<string, string>;
};

type ApiResponse = {
  ok?: boolean;
  error?: string;
  message?: string;
  company?: { name?: string };
  configuration?: Configuration;
};

const CART_NAMES: Record<number, string> = {
  1: 'Primer recordatorio',
  2: 'Segundo mensaje · bono',
  3: 'Último mensaje · vencimiento',
};

const EMPTY_MESSAGE: MessageConfig = {
  body: '',
  deliveryMode: 'session',
  templateName: '',
  templateLanguage: 'es_CO',
};

const EMPTY_CONFIGURATION: Configuration = {
  cartRules: [],
  orderCreated: EMPTY_MESSAGE,
  fulfillmentCreated: EMPTY_MESSAGE,
  variables: {
    abandonedCart: [],
    orderCreated: [],
    fulfillmentCreated: [],
  },
  samples: {},
};

function delayText(minutes: number): string {
  if (minutes < 60) return `${minutes} minutos`;
  if (minutes % 60 === 0) return `${minutes / 60} horas`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function preview(
  body: string,
  samples: Record<string, string>,
): string {
  return body.replace(
    /\{\{([a-z_]+)\}\}/g,
    (token, key: string) => samples[key] || token,
  );
}

function appendVariable(body: string, variable: string): string {
  const separator = body && !body.endsWith('\n') ? ' ' : '';
  return `${body}${separator}${variable}`;
}

function MessageFields({
  value,
  variables,
  samples,
  onChange,
}: {
  value: MessageConfig;
  variables: string[];
  samples: Record<string, string>;
  onChange: (next: MessageConfig) => void;
}) {
  return (
    <>
      <label className={styles.field}>
        <span>Mensaje base</span>
        <textarea
          rows={9}
          value={value.body}
          onChange={(event) =>
            onChange({ ...value, body: event.target.value })
          }
          placeholder="Escribe el mensaje que recibirá el cliente."
        />
      </label>

      <div className={styles.variables}>
        <strong>Variables disponibles</strong>
        <p>
          Toca una variable para agregarla al final del mensaje.
        </p>
        <div>
          {variables.map((variable) => (
            <button
              type="button"
              key={variable}
              onClick={() =>
                onChange({
                  ...value,
                  body: appendVariable(value.body, variable),
                })
              }
            >
              {variable}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.deliveryGrid}>
        <label className={styles.field}>
          <span>Forma de envío</span>
          <select
            value={value.deliveryMode}
            onChange={(event) =>
              onChange({
                ...value,
                deliveryMode:
                  event.target.value === 'template'
                    ? 'template'
                    : 'session',
              })
            }
          >
            <option value="session">
              Texto dentro de conversación
            </option>
            <option value="template">
              Plantilla aprobada en Meta
            </option>
          </select>
        </label>

        {value.deliveryMode === 'template' ? (
          <>
            <label className={styles.field}>
              <span>Nombre de plantilla Meta</span>
              <input
                value={value.templateName}
                onChange={(event) =>
                  onChange({
                    ...value,
                    templateName: event.target.value,
                  })
                }
                placeholder="pedido_confirmado"
              />
            </label>

            <label className={styles.field}>
              <span>Idioma de plantilla</span>
              <input
                value={value.templateLanguage}
                onChange={(event) =>
                  onChange({
                    ...value,
                    templateLanguage: event.target.value,
                  })
                }
                placeholder="es_CO"
              />
            </label>
          </>
        ) : null}
      </div>

      <div className={styles.preview}>
        <span>Vista previa con datos de ejemplo</span>
        <p>{preview(value.body, samples) || 'Escribe un mensaje.'}</p>
      </div>
    </>
  );
}

export default function AutomationMessagesPage() {
  const [companyName, setCompanyName] = useState('Empresa');
  const [configuration, setConfiguration] =
    useState<Configuration>(EMPTY_CONFIGURATION);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/automation-messages', {
        cache: 'no-store',
      });
      const data = (await response.json()) as ApiResponse;

      if (!response.ok || !data.ok || !data.configuration) {
        throw new Error(
          data.error || 'No se pudieron cargar los mensajes.',
        );
      }

      setCompanyName(data.company?.name || 'Empresa');
      setConfiguration(data.configuration);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'No se pudieron cargar los mensajes.',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function updateCart(
    sequence: number,
    values: Partial<CartRule>,
  ) {
    setConfiguration((current) => ({
      ...current,
      cartRules: current.cartRules.map((rule) =>
        rule.sequence === sequence
          ? { ...rule, ...values }
          : rule,
      ),
    }));
  }

  function updateMessage(
    key: 'orderCreated' | 'fulfillmentCreated',
    value: MessageConfig,
  ) {
    setConfiguration((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function save(
    automationKey:
      | 'abandoned_cart'
      | 'order_created'
      | 'fulfillment_created',
  ) {
    setSaving(automationKey);
    setMessage('');
    setError('');

    try {
      const payload =
        automationKey === 'abandoned_cart'
          ? {
              automationKey,
              rules: configuration.cartRules,
            }
          : {
              automationKey,
              message:
                automationKey === 'order_created'
                  ? configuration.orderCreated
                  : configuration.fulfillmentCreated,
            };

      const response = await fetch('/api/automation-messages', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as ApiResponse;

      if (!response.ok || !data.ok || !data.configuration) {
        throw new Error(
          data.error || 'No se pudieron guardar los mensajes.',
        );
      }

      setConfiguration(data.configuration);
      setMessage(data.message || 'Mensajes guardados.');
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'No se pudieron guardar los mensajes.',
      );
    } finally {
      setSaving('');
    }
  }

  return (
    <main className={styles.shell}>
      <AppSidebar companyName={companyName} />

      <section className={styles.workspace}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>
              AUTOMATIZACIONES · MENSAJES
            </p>
            <h1>Mensajes automáticos · {companyName}</h1>
            <p>
              Cada empresa define su texto. ChatPro solo reemplazará
              variables con datos reales.
            </p>
          </div>

          <button
            type="button"
            className={styles.back}
            onClick={() =>
              window.location.assign('/automatizaciones')
            }
          >
            ← Volver
          </button>
        </header>

        <div className={styles.notice}>
          <strong>Configuración segura</strong>
          <p>
            Guardar estos mensajes no activa automatizaciones ni envía
            WhatsApp. Los flujos siguen pausados hasta la prueba final.
          </p>
        </div>

        {error ? <p className={styles.error}>{error}</p> : null}
        {message ? (
          <p className={styles.success}>{message}</p>
        ) : null}

        {loading ? (
          <div className={styles.loading}>
            Cargando mensajes…
          </div>
        ) : (
          <div className={styles.flowList}>
            <section className={styles.flow}>
              <div className={styles.flowHeading}>
                <div>
                  <p>SHOPIFY · CARRITO</p>
                  <h2>Carrito abandonado</h2>
                  <span>
                    Configura el recordatorio, el mensaje con bono y el
                    aviso final.
                  </span>
                </div>
              </div>

              <div className={styles.cartRules}>
                {configuration.cartRules.map((rule) => (
                  <article
                    className={styles.messageCard}
                    key={rule.sequence}
                  >
                    <div className={styles.messageHeading}>
                      <div>
                        <span>Mensaje {rule.sequence}</span>
                        <h3>
                          {CART_NAMES[rule.sequence] ||
                            `Mensaje ${rule.sequence}`}
                        </h3>
                        <p>
                          Envío actual: {delayText(rule.delayMinutes)}
                        </p>
                      </div>

                      <label className={styles.activeToggle}>
                        <input
                          type="checkbox"
                          checked={rule.active}
                          onChange={(event) =>
                            updateCart(rule.sequence, {
                              active: event.target.checked,
                            })
                          }
                        />
                        <span>
                          {rule.active ? 'Activo' : 'Pausado'}
                        </span>
                      </label>
                    </div>

                    <label className={styles.field}>
                      <span>Enviar después de</span>
                      <div className={styles.delayInput}>
                        <input
                          type="number"
                          min={1}
                          max={43200}
                          value={rule.delayMinutes}
                          onChange={(event) =>
                            updateCart(rule.sequence, {
                              delayMinutes:
                                Number(event.target.value) || 1,
                            })
                          }
                        />
                        <small>minutos</small>
                      </div>
                    </label>

                    <MessageFields
                      value={rule}
                      variables={
                        configuration.variables.abandonedCart
                      }
                      samples={configuration.samples}
                      onChange={(next) =>
                        updateCart(rule.sequence, next)
                      }
                    />
                  </article>
                ))}
              </div>

              <button
                type="button"
                className={styles.save}
                disabled={saving === 'abandoned_cart'}
                onClick={() => void save('abandoned_cart')}
              >
                {saving === 'abandoned_cart'
                  ? 'Guardando…'
                  : 'Guardar los 3 mensajes'}
              </button>
            </section>

            <section className={styles.flow}>
              <div className={styles.flowHeading}>
                <div>
                  <p>SHOPIFY · PEDIDO</p>
                  <h2>Confirmación de pedido</h2>
                  <span>
                    Incluye el número, el resumen, el total y el enlace
                    real del pedido. El descuento para la próxima compra
                    se escribe directamente en el mensaje.
                  </span>
                </div>
              </div>

              <article className={styles.messageCard}>
                <MessageFields
                  value={configuration.orderCreated}
                  variables={configuration.variables.orderCreated}
                  samples={configuration.samples}
                  onChange={(next) =>
                    updateMessage('orderCreated', next)
                  }
                />
              </article>

              <button
                type="button"
                className={styles.save}
                disabled={saving === 'order_created'}
                onClick={() => void save('order_created')}
              >
                {saving === 'order_created'
                  ? 'Guardando…'
                  : 'Guardar confirmación de pedido'}
              </button>
            </section>

            <section className={styles.flow}>
              <div className={styles.flowHeading}>
                <div>
                  <p>SHOPIFY · ENVÍO</p>
                  <h2>Guía o envío creado</h2>
                  <span>
                    ChatPro completará transportadora, número de guía y
                    enlace de seguimiento usando Shopify.
                  </span>
                </div>
              </div>

              <article className={styles.messageCard}>
                <MessageFields
                  value={configuration.fulfillmentCreated}
                  variables={
                    configuration.variables.fulfillmentCreated
                  }
                  samples={configuration.samples}
                  onChange={(next) =>
                    updateMessage('fulfillmentCreated', next)
                  }
                />
              </article>

              <button
                type="button"
                className={styles.save}
                disabled={saving === 'fulfillment_created'}
                onClick={() => void save('fulfillment_created')}
              >
                {saving === 'fulfillment_created'
                  ? 'Guardando…'
                  : 'Guardar mensaje de guía'}
              </button>
            </section>
          </div>
        )}
      </section>
    </main>
  );
}
