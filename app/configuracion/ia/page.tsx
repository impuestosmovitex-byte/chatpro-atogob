
'use client';

import { AppSidebar } from '../../components/AppSidebar';
import { FormEvent, useEffect, useState } from 'react';
import styles from './page.module.css';

type CommercialFlow = {
  welcomeMessage: string;
  salesInstructions: string;
  shippingInstructions: string;
  paymentInstructions: string;
  checkoutInstructions: string;
};

type Configuration = {
  assistantName: string;
  tone: string;
  aiInstructions: string;
  commercialFlow: CommercialFlow;
};

type ResponseData = {
  ok?: boolean;
  error?: string;
  company?: { name?: string };
  configuration?: Partial<Configuration>;
};

const EMPTY_FLOW: CommercialFlow = {
  welcomeMessage: '',
  salesInstructions: '',
  shippingInstructions: '',
  paymentInstructions: '',
  checkoutInstructions: '',
};

const EMPTY: Configuration = {
  assistantName: '',
  tone: 'Cercana, clara, breve y profesional',
  aiInstructions: '',
  commercialFlow: EMPTY_FLOW,
};

function normalizeConfiguration(value?: Partial<Configuration>): Configuration {
  return {
    assistantName: value?.assistantName ?? '',
    tone: value?.tone?.trim() || EMPTY.tone,
    aiInstructions: value?.aiInstructions ?? '',
    commercialFlow: {
      ...EMPTY_FLOW,
      ...(value?.commercialFlow ?? {}),
    },
  };
}

export default function ConfiguracionPage() {
  const [configuration, setConfiguration] =
    useState<Configuration>(EMPTY);
  const [companyName, setCompanyName] = useState('Empresa');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch('/api/settings', {
          cache: 'no-store',
        });
        const data = (await response.json()) as ResponseData;

        if (!response.ok || !data.ok || !data.configuration) {
          throw new Error(
            data.error || 'No se pudo cargar la configuración.',
          );
        }

        setConfiguration(normalizeConfiguration(data.configuration));
        setCompanyName(data.company?.name || 'Empresa');
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : 'No se pudo cargar la configuración.',
        );
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, []);

  function updateFlow(key: keyof CommercialFlow, value: string) {
    setConfiguration((current) => ({
      ...current,
      commercialFlow: {
        ...current.commercialFlow,
        [key]: value,
      },
    }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage('');

    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(configuration),
      });

      const data = (await response.json()) as ResponseData;

      if (!response.ok || !data.ok || !data.configuration) {
        throw new Error(data.error || 'No se pudo guardar.');
      }

      setConfiguration(normalizeConfiguration(data.configuration));
      setMessage(
        'Configuración guardada. La IA usará estas reglas en las nuevas conversaciones.',
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'No se pudo guardar la configuración.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className={styles.shell}>
      <AppSidebar companyName={companyName} />
      <section className={styles.workspace}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>CONFIGURACIÓN COMERCIAL</p>
            <h1>Asistente y ventas · {companyName}</h1>
            <p>Define cómo atiende, vende y cierra compras el asistente de esta empresa.</p>
          </div>
          <button
            type="button"
            className={styles.back}
            onClick={() => window.location.assign('/configuracion')}
          >
            ← Volver
          </button>
        </header>

        <form className={styles.form} onSubmit={save}>
          <section className={styles.card}>
            <div className={styles.sectionHeading}>
              <div>
                <p>1. IDENTIDAD DEL ASISTENTE</p>
                <h2>Cómo se presenta y conversa</h2>
              </div>
              <span>Exclusivo de {companyName}</span>
            </div>

            <div className={styles.grid}>
              <label>
                <span>Nombre del asistente</span>
                <input
                  value={configuration.assistantName}
                  onChange={(event) =>
                    setConfiguration((current) => ({
                      ...current,
                      assistantName: event.target.value,
                    }))
                  }
                  placeholder="Ejemplo: Laura"
                  disabled={loading}
                />
              </label>

              <label>
                <span>Tono de atención</span>
                <input
                  value={configuration.tone}
                  onChange={(event) =>
                    setConfiguration((current) => ({
                      ...current,
                      tone: event.target.value,
                    }))
                  }
                  placeholder="Ejemplo: Cercana, clara y vendedora"
                  disabled={loading}
                />
              </label>
            </div>

            <label>
              <span>Saludo inicial antes del menú</span>
              <textarea
                value={configuration.commercialFlow.welcomeMessage}
                onChange={(event) =>
                  updateFlow('welcomeMessage', event.target.value)
                }
                placeholder="Ejemplo: Hola, soy {asistente} de {empresa}. Estoy aquí para ayudarte."
                rows={3}
                disabled={loading}
              />
              <small>
                Puedes usar {'{asistente}'} y {'{empresa}'}. Después se mostrarán las áreas activas, como Ventas o Servicio al cliente.
              </small>
            </label>

            <div className={styles.menuNote}>
              <div>
                <strong>Menú de atención</strong>
                <p>
                  Las opciones del menú se crean en Áreas de atención. Allí decides si mostrar Ventas, Servicio al cliente, Garantías u otras áreas.
                </p>
              </div>
              <button
                type="button"
                className={styles.secondary}
                onClick={() =>
                  window.location.assign('/configuracion/areas-atencion')
                }
              >
                Configurar áreas
              </button>
            </div>
          </section>

          <section className={styles.card}>
            <div className={styles.sectionHeading}>
              <div>
                <p>2. FLUJO COMERCIAL</p>
                <h2>Qué debe hacer para vender</h2>
              </div>
            </div>

            <label>
              <span>Proceso de ventas</span>
              <textarea
                value={configuration.commercialFlow.salesInstructions}
                onChange={(event) =>
                  updateFlow('salesInstructions', event.target.value)
                }
                placeholder="Ejemplo: En Ventas, primero pregunta qué producto busca y para qué ciudad. Cuando comparta un enlace, confirma el producto real, la variante y acompaña la decisión de compra."
                rows={6}
                disabled={loading}
              />
            </label>

            <label>
              <span>Ciudades y envíos</span>
              <textarea
                value={configuration.commercialFlow.shippingInstructions}
                onChange={(event) =>
                  updateFlow('shippingInstructions', event.target.value)
                }
                placeholder="Ejemplo: Para Cali el envío cuesta $13.900. Confirma ciudad antes de hablar de tiempos, costo o disponibilidad de contraentrega. No inventes condiciones."
                rows={5}
                disabled={loading}
              />
            </label>

            <label>
              <span>Medios de pago</span>
              <textarea
                value={configuration.commercialFlow.paymentInstructions}
                onChange={(event) =>
                  updateFlow('paymentInstructions', event.target.value)
                }
                placeholder="Ejemplo: Contraentrega solo está disponible en Bogotá. Para otras ciudades ofrece Addi, Sistecrédito, SUMAS, transferencia o tarjeta según corresponda."
                rows={5}
                disabled={loading}
              />
            </label>

            <label>
              <span>Cuándo enviar el checkout</span>
              <textarea
                value={configuration.commercialFlow.checkoutInstructions}
                onChange={(event) =>
                  updateFlow('checkoutInstructions', event.target.value)
                }
                placeholder="Ejemplo: Solo envía el checkout después de confirmar producto, variante, ciudad y medio de pago. Para Addi, indica que complete sus datos en Shopify y seleccione Addi al final."
                rows={5}
                disabled={loading}
              />
            </label>
          </section>

          <section className={styles.card}>
            <div className={styles.sectionHeading}>
              <div>
                <p>3. INSTRUCCIONES ADICIONALES</p>
                <h2>Promociones, estilo y casos especiales</h2>
              </div>
            </div>

            <label>
              <span>Guía adicional para el asistente</span>
              <textarea
                value={configuration.aiInstructions}
                onChange={(event) =>
                  setConfiguration((current) => ({
                    ...current,
                    aiInstructions: event.target.value,
                  }))
                }
                placeholder="Escribe promociones vigentes, venta cruzada, garantías, mensajes que deben usarse, políticas o cuándo transferir a un asesor."
                rows={10}
                disabled={loading}
              />
            </label>

            <div className={styles.help}>
              El asistente usa estas reglas solo para {companyName}. La empresa debe mantenerlas actualizadas; el asistente no inventa ni cambia políticas por su cuenta.
            </div>
          </section>

          {message ? <p className={styles.message}>{message}</p> : null}

          <button
            className={styles.save}
            type="submit"
            disabled={loading || saving}
          >
            {saving ? 'Guardando…' : 'Guardar configuración comercial'}
          </button>
        </form>
      </section>
    </main>
  );
}
