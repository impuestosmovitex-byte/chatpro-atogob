
'use client';

import { AppSidebar } from '../../components/AppSidebar';
import { FormEvent, useEffect, useState } from 'react';
import styles from './page.module.css';

type ResponseLength = 'brief' | 'balanced' | 'detailed';

type CommercialFlow = {
  welcomeMessage: string;
  areaWelcomeMessage: string;
  responseLength: ResponseLength;
  maxQuestionsPerMessage: number;
  avoidRepetition: boolean;
  showRestrictionsOnlyWhenRelevant: boolean;
  askBeforeShowingCatalog: boolean;
  salesInstructions: string;
  shippingInstructions: string;
  paymentInstructions: string;
  checkoutInstructions: string;
};

type KnowledgeBase = {
  termsConditions: string;
  exchangesReturns: string;
  warranties: string;
  policiesFaq: string;
};

type CartRecoverySettings = {
  fallbackMessage: string;
  defaultCountryCode: string;
  replyContextHours: number;
  testMode: boolean;
  testPhones: string;
};

type ShippingCarrier = {
  displayName: string;
  aliases: string;
  trackingUrl: string;
  instructions: string;
  isActive: boolean;
};

type ShippingTrackingSettings = {
  enabled: boolean;
  fallbackInstructions: string;
  carriers: ShippingCarrier[];
};

type Configuration = {
  assistantName: string;
  tone: string;
  aiInstructions: string;
  commercialFlow: CommercialFlow;
  knowledgeBase: KnowledgeBase;
  cartRecovery: CartRecoverySettings;
  shippingTracking: ShippingTrackingSettings;
};

type ResponseData = {
  ok?: boolean;
  error?: string;
  company?: { name?: string };
  configuration?: Partial<Configuration>;
};

const EMPTY_FLOW: CommercialFlow = {
  welcomeMessage: '',
  areaWelcomeMessage: '',
  responseLength: 'brief',
  maxQuestionsPerMessage: 1,
  avoidRepetition: true,
  showRestrictionsOnlyWhenRelevant: true,
  askBeforeShowingCatalog: true,
  salesInstructions: '',
  shippingInstructions: '',
  paymentInstructions: '',
  checkoutInstructions: '',
};

const EMPTY_KNOWLEDGE: KnowledgeBase = {
  termsConditions: '',
  exchangesReturns: '',
  warranties: '',
  policiesFaq: '',
};

const EMPTY_CART_RECOVERY: CartRecoverySettings = {
  fallbackMessage: '',
  defaultCountryCode: '57',
  replyContextHours: 72,
  testMode: true,
  testPhones: '',
};

const EMPTY_SHIPPING_TRACKING: ShippingTrackingSettings = {
  enabled: false,
  fallbackInstructions:
    'Ingresa al enlace principal de la transportadora, busca la opción de seguimiento o rastreo, copia la guía y consulta el estado del envío.',
  carriers: [],
};

const EMPTY: Configuration = {
  assistantName: '',
  tone: 'Cercana, clara, breve y profesional',
  aiInstructions: '',
  commercialFlow: EMPTY_FLOW,
  knowledgeBase: EMPTY_KNOWLEDGE,
  cartRecovery: EMPTY_CART_RECOVERY,
  shippingTracking: EMPTY_SHIPPING_TRACKING,
};

function normalizeCartRecovery(
  value?: Partial<CartRecoverySettings>,
): CartRecoverySettings {
  const hours = Number(
    value?.replyContextHours ?? EMPTY_CART_RECOVERY.replyContextHours,
  );

  return {
    fallbackMessage: value?.fallbackMessage ?? '',
    defaultCountryCode:
      value?.defaultCountryCode ?? EMPTY_CART_RECOVERY.defaultCountryCode,
    replyContextHours:
      Number.isInteger(hours) && hours >= 1 && hours <= 168
        ? hours
        : EMPTY_CART_RECOVERY.replyContextHours,
    testMode:
      typeof value?.testMode === 'boolean'
        ? value.testMode
        : EMPTY_CART_RECOVERY.testMode,
    testPhones: value?.testPhones ?? '',
  };
}

function normalizeShippingTracking(
  value?: Partial<ShippingTrackingSettings>,
): ShippingTrackingSettings {
  const carriers = Array.isArray(value?.carriers)
    ? value.carriers.map((carrier) => ({
        displayName: carrier?.displayName ?? '',
        aliases: carrier?.aliases ?? '',
        trackingUrl: carrier?.trackingUrl ?? '',
        instructions: carrier?.instructions ?? '',
        isActive:
          typeof carrier?.isActive === 'boolean' ? carrier.isActive : true,
      }))
    : [];

  return {
    enabled:
      typeof value?.enabled === 'boolean'
        ? value.enabled
        : carriers.length > 0,
    fallbackInstructions:
      value?.fallbackInstructions ??
      EMPTY_SHIPPING_TRACKING.fallbackInstructions,
    carriers,
  };
}

function normalizeConfiguration(value?: Partial<Configuration>): Configuration {
  const flow: Partial<CommercialFlow> =
    value?.commercialFlow ?? {};
  const maxQuestions = Number(flow.maxQuestionsPerMessage);
  const responseLength =
    flow.responseLength === 'balanced' ||
    flow.responseLength === 'detailed'
      ? flow.responseLength
      : 'brief';

  return {
    assistantName: value?.assistantName ?? '',
    tone: value?.tone?.trim() || EMPTY.tone,
    aiInstructions: value?.aiInstructions ?? '',
    commercialFlow: {
      ...EMPTY_FLOW,
      ...flow,
      responseLength,
      maxQuestionsPerMessage:
        Number.isInteger(maxQuestions) &&
        maxQuestions >= 1 &&
        maxQuestions <= 3
          ? maxQuestions
          : 1,
      avoidRepetition:
        typeof flow.avoidRepetition === 'boolean'
          ? flow.avoidRepetition
          : true,
      showRestrictionsOnlyWhenRelevant:
        typeof flow.showRestrictionsOnlyWhenRelevant === 'boolean'
          ? flow.showRestrictionsOnlyWhenRelevant
          : true,
      askBeforeShowingCatalog:
        typeof flow.askBeforeShowingCatalog === 'boolean'
          ? flow.askBeforeShowingCatalog
          : true,
    },
    knowledgeBase: {
      ...EMPTY_KNOWLEDGE,
      ...(value?.knowledgeBase ?? {}),
    },
    cartRecovery: normalizeCartRecovery(value?.cartRecovery),
    shippingTracking: normalizeShippingTracking(value?.shippingTracking),
  };
}


const INSTRUCTION_LIMITS = {
  salesInstructions: 50_000,
  shippingInstructions: 50_000,
  paymentInstructions: 50_000,
  checkoutInstructions: 60_000,
  termsConditions: 60_000,
  exchangesReturns: 60_000,
  warranties: 40_000,
  policiesFaq: 80_000,
  aiInstructions: 100_000,
} as const;

type InstructionLimitKey = keyof typeof INSTRUCTION_LIMITS;

const INSTRUCTION_LABELS: Record<InstructionLimitKey, string> = {
  salesInstructions: 'Proceso de ventas',
  shippingInstructions: 'Ciudades y envíos',
  paymentInstructions: 'Medios de pago',
  checkoutInstructions: 'Finalización de compra y checkout',
  termsConditions: 'Términos y condiciones',
  exchangesReturns: 'Cambios y devoluciones',
  warranties: 'Garantías',
  policiesFaq: 'Preguntas frecuentes y políticas adicionales',
  aiInstructions: 'Promociones, estilo y casos especiales',
};

function formatCharacters(value: number) {
  return new Intl.NumberFormat('es-CO').format(value);
}

function CharacterCounter({
  value,
  limit,
}: {
  value: string;
  limit: number;
}) {
  const used = value.length;
  const remaining = limit - used;
  const exceeded = remaining < 0;

  return (
    <small
      className={
        exceeded ? styles.characterCounterOver : styles.characterCounter
      }
    >
      {exceeded
        ? `${formatCharacters(used)} utilizados · límite superado por ${formatCharacters(
            Math.abs(remaining),
          )} · máximo ${formatCharacters(limit)}`
        : `${formatCharacters(used)} utilizados · ${formatCharacters(
            remaining,
          )} disponibles · máximo ${formatCharacters(limit)}`}
    </small>
  );
}

function getExceededInstructionFields(configuration: Configuration) {
  const values: Record<InstructionLimitKey, string> = {
    salesInstructions: configuration.commercialFlow.salesInstructions,
    shippingInstructions: configuration.commercialFlow.shippingInstructions,
    paymentInstructions: configuration.commercialFlow.paymentInstructions,
    checkoutInstructions: configuration.commercialFlow.checkoutInstructions,
    termsConditions: configuration.knowledgeBase.termsConditions,
    exchangesReturns: configuration.knowledgeBase.exchangesReturns,
    warranties: configuration.knowledgeBase.warranties,
    policiesFaq: configuration.knowledgeBase.policiesFaq,
    aiInstructions: configuration.aiInstructions,
  };

  return (Object.keys(INSTRUCTION_LIMITS) as InstructionLimitKey[])
    .filter((key) => values[key].length > INSTRUCTION_LIMITS[key])
    .map((key) => ({
      key,
      label: INSTRUCTION_LABELS[key],
      used: values[key].length,
      limit: INSTRUCTION_LIMITS[key],
    }));
}

export default function ConfiguracionPage() {
  const [configuration, setConfiguration] =
    useState<Configuration>(EMPTY);
  const [companyName, setCompanyName] = useState('Empresa');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const exceededInstructionFields =
    getExceededInstructionFields(configuration);
  const hasExceededInstructionLimits =
    exceededInstructionFields.length > 0;

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

  function updateFlow<K extends keyof CommercialFlow>(
    key: K,
    value: CommercialFlow[K],
  ) {
    setConfiguration((current) => ({
      ...current,
      commercialFlow: {
        ...current.commercialFlow,
        [key]: value,
      },
    }));
  }

  function updateKnowledge(key: keyof KnowledgeBase, value: string) {
    setConfiguration((current) => ({
      ...current,
      knowledgeBase: {
        ...current.knowledgeBase,
        [key]: value,
      },
    }));
  }

  function updateCartRecovery(
    key: keyof CartRecoverySettings,
    value: string | number | boolean,
  ) {
    setConfiguration((current) => ({
      ...current,
      cartRecovery: {
        ...current.cartRecovery,
        [key]: value,
      },
    }));
  }

  function updateShippingTracking(
    key: 'enabled' | 'fallbackInstructions',
    value: string | boolean,
  ) {
    setConfiguration((current) => ({
      ...current,
      shippingTracking: {
        ...current.shippingTracking,
        [key]: value,
      },
    }));
  }

  function addCarrier() {
    setConfiguration((current) => ({
      ...current,
      shippingTracking: {
        ...current.shippingTracking,
        enabled: true,
        carriers: [
          ...current.shippingTracking.carriers,
          {
            displayName: '',
            aliases: '',
            trackingUrl: '',
            instructions: '',
            isActive: true,
          },
        ],
      },
    }));
  }

  function updateCarrier(
    index: number,
    key: keyof ShippingCarrier,
    value: string | boolean,
  ) {
    setConfiguration((current) => ({
      ...current,
      shippingTracking: {
        ...current.shippingTracking,
        carriers: current.shippingTracking.carriers.map((carrier, itemIndex) =>
          itemIndex === index ? { ...carrier, [key]: value } : carrier,
        ),
      },
    }));
  }

  function removeCarrier(index: number) {
    setConfiguration((current) => ({
      ...current,
      shippingTracking: {
        ...current.shippingTracking,
        carriers: current.shippingTracking.carriers.filter(
          (_carrier, itemIndex) => itemIndex !== index,
        ),
      },
    }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const exceeded = getExceededInstructionFields(configuration);

    if (exceeded.length > 0) {
      const details = exceeded
        .map(
          (field) =>
            `${field.label}: ${formatCharacters(field.used)} de ${formatCharacters(
              field.limit,
            )}`,
        )
        .join(' · ');

      setMessage(
        `No se pudo guardar. Estos campos superan el límite: ${details}`,
      );
      return;
    }

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
        'Configuración guardada. La IA usará estas reglas y políticas en las nuevas conversaciones.',
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
            <p>Define cómo atiende, vende y responde sobre políticas el asistente de esta empresa.</p>
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

            <label>
              <span>Mensaje al entrar a un área</span>
              <textarea
                value={configuration.commercialFlow.areaWelcomeMessage}
                onChange={(event) =>
                  updateFlow('areaWelcomeMessage', event.target.value)
                }
                placeholder="Ejemplo: Perfecto 😊 ¿Qué producto estás buscando? También puedes enviarme una foto o enlace."
                rows={3}
                disabled={loading}
              />
              <small>
                Puedes usar {'{asistente}'}, {'{empresa}'} y {'{area}'}. Este mensaje se muestra después de elegir un área.
              </small>
            </label>
          </section>

          <section className={styles.card}>
            <div className={styles.sectionHeading}>
              <div>
                <p>2. FLUJO COMERCIAL</p>
                <h2>Qué debe hacer para vender</h2>
              </div>
              <span>Configurable por empresa</span>
            </div>

            <div className={styles.grid}>
              <label>
                <span>Longitud de respuesta</span>
                <select
                  value={configuration.commercialFlow.responseLength}
                  onChange={(event) =>
                    updateFlow(
                      'responseLength',
                      event.target.value as ResponseLength,
                    )
                  }
                  disabled={loading}
                >
                  <option value="brief">Breve</option>
                  <option value="balanced">Equilibrada</option>
                  <option value="detailed">Detallada</option>
                </select>
                <small>
                  Breve muestra solo lo necesario para avanzar al siguiente paso.
                </small>
              </label>

              <label>
                <span>Preguntas principales por mensaje</span>
                <select
                  value={configuration.commercialFlow.maxQuestionsPerMessage}
                  onChange={(event) =>
                    updateFlow(
                      'maxQuestionsPerMessage',
                      Number(event.target.value),
                    )
                  }
                  disabled={loading}
                >
                  <option value={1}>1 pregunta</option>
                  <option value={2}>Hasta 2 preguntas</option>
                  <option value={3}>Hasta 3 preguntas</option>
                </select>
                <small>
                  Una pregunta evita abrumar al cliente durante la compra.
                </small>
              </label>
            </div>

            <label>
              <span>No repetir información ya confirmada</span>
              <input
                type="checkbox"
                checked={configuration.commercialFlow.avoidRepetition}
                onChange={(event) =>
                  updateFlow('avoidRepetition', event.target.checked)
                }
                disabled={loading}
              />
              <small>
                Evita repetir ciudad, costo de envío, color, talla o medio de pago.
              </small>
            </label>

            <label>
              <span>Mostrar restricciones solo cuando sean relevantes</span>
              <input
                type="checkbox"
                checked={
                  configuration.commercialFlow
                    .showRestrictionsOnlyWhenRelevant
                }
                onChange={(event) =>
                  updateFlow(
                    'showRestrictionsOnlyWhenRelevant',
                    event.target.checked,
                  )
                }
                disabled={loading}
              />
              <small>
                No anuncia opciones no disponibles salvo que el cliente pregunte o intente seleccionarlas.
              </small>
            </label>

            <label>
              <span>Preguntar antes de mostrar el catálogo</span>
              <input
                type="checkbox"
                checked={
                  configuration.commercialFlow.askBeforeShowingCatalog
                }
                onChange={(event) =>
                  updateFlow(
                    'askBeforeShowingCatalog',
                    event.target.checked,
                  )
                }
                disabled={loading}
              />
              <small>
                Primero pregunta qué busca y después muestra solo la colección o productos relacionados.
              </small>
            </label>

            <label>
              <span>Proceso de ventas</span>
              <textarea
                value={configuration.commercialFlow.salesInstructions}
                onChange={(event) =>
                  updateFlow('salesInstructions', event.target.value)
                }
                placeholder="Ejemplo: En Ventas, primero pregunta qué producto busca y para qué ciudad. Cuando comparta un enlace, confirma el producto real, la variante y acompaña la decisión de compra."
                rows={6}
                maxLength={INSTRUCTION_LIMITS.salesInstructions}
                disabled={loading}
              />
              <CharacterCounter
                value={configuration.commercialFlow.salesInstructions}
                limit={INSTRUCTION_LIMITS.salesInstructions}
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
                maxLength={INSTRUCTION_LIMITS.shippingInstructions}
                disabled={loading}
              />
              <CharacterCounter
                value={configuration.commercialFlow.shippingInstructions}
                limit={INSTRUCTION_LIMITS.shippingInstructions}
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
                maxLength={INSTRUCTION_LIMITS.paymentInstructions}
                disabled={loading}
              />
              <CharacterCounter
                value={configuration.commercialFlow.paymentInstructions}
                limit={INSTRUCTION_LIMITS.paymentInstructions}
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
                maxLength={INSTRUCTION_LIMITS.checkoutInstructions}
                disabled={loading}
              />
              <CharacterCounter
                value={configuration.commercialFlow.checkoutInstructions}
                limit={INSTRUCTION_LIMITS.checkoutInstructions}
              />
            </label>
          </section>

          <section className={styles.card}>
            <div className={styles.sectionHeading}>
              <div>
                <p>3. RECUPERACIÓN DE CARRITOS</p>
                <h2>Mensajes y seguridad para carritos abandonados</h2>
              </div>
              <span>Configurable por empresa</span>
            </div>

            <label>
              <span>Mensaje de respaldo si la IA no puede redactar</span>
              <textarea
                value={configuration.cartRecovery.fallbackMessage}
                onChange={(event) =>
                  updateCartRecovery('fallbackMessage', event.target.value)
                }
                placeholder={"Hola 👋 Vimos que dejaste productos en tu carrito.\n\nPuedes retomar tu compra aquí:\n{checkout_url}\n\nSi tienes dudas, escríbenos y te ayudamos."}
                rows={6}
                disabled={loading}
              />
              <small>
                Usa {'{checkout_url}'} donde debe ir el enlace real. Si no lo
                usas, Chat Pro agregará el enlace al final.
              </small>
            </label>

            <div className={styles.grid}>
              <label>
                <span>Código país por defecto</span>
                <input
                  value={configuration.cartRecovery.defaultCountryCode}
                  onChange={(event) =>
                    updateCartRecovery(
                      'defaultCountryCode',
                      event.target.value,
                    )
                  }
                  placeholder="Ejemplo: 57"
                  disabled={loading}
                />
                <small>
                  Se usa para teléfonos nacionales sin indicativo.
                </small>
              </label>

              <label>
                <span>Horas para reconocer respuesta del cliente</span>
                <input
                  type="number"
                  min={1}
                  max={168}
                  value={configuration.cartRecovery.replyContextHours}
                  onChange={(event) =>
                    updateCartRecovery(
                      'replyContextHours',
                      Number(event.target.value) || 72,
                    )
                  }
                  disabled={loading}
                />
                <small>
                  Durante este tiempo, la IA sabe que el cliente responde a un carrito recuperado.
                </small>
              </label>
            </div>

            <label>
              <span>Modo prueba de recuperación</span>
              <input
                type="checkbox"
                checked={configuration.cartRecovery.testMode}
                onChange={(event) =>
                  updateCartRecovery('testMode', event.target.checked)
                }
                disabled={loading}
              />
              <small>
                Activo recomendado antes de WhatsApp real. Solo envía recuperaciones a los teléfonos de prueba.
              </small>
            </label>

            <label>
              <span>Teléfonos de prueba</span>
              <textarea
                value={configuration.cartRecovery.testPhones}
                onChange={(event) =>
                  updateCartRecovery('testPhones', event.target.value)
                }
                placeholder="Ejemplo: 573001234567\n573209876543"
                rows={4}
                disabled={loading}
              />
              <small>
                Un teléfono por línea o separados por coma. Con modo prueba apagado, no limita el envío.
              </small>
            </label>
          </section>

            <section className={styles.card}>
              <div className={styles.sectionHeading}>
                <div>
                  <p>4. TRANSPORTADORAS Y SEGUIMIENTO</p>
                  <h2>Cómo responder guías y rastreos</h2>
                </div>
                <span>Configurable por empresa</span>
              </div>

              <label>
                <span>Activar seguimiento con transportadoras</span>
                <input
                  type="checkbox"
                  checked={configuration.shippingTracking.enabled}
                  onChange={(event) =>
                    updateShippingTracking('enabled', event.target.checked)
                  }
                  disabled={loading}
                />
                <small>
                  Si la empresa no maneja envíos con transportadora, déjalo apagado y sin transportadoras.
                </small>
              </label>

              <label>
                <span>Instrucción general de seguimiento</span>
                <textarea
                  value={configuration.shippingTracking.fallbackInstructions}
                  onChange={(event) =>
                    updateShippingTracking(
                      'fallbackInstructions',
                      event.target.value,
                    )
                  }
                  placeholder="Ejemplo: Ingresa al enlace principal de la transportadora, busca seguimiento, copia la guía y consulta el estado."
                  rows={4}
                  disabled={loading}
                />
              </label>

              <div className={styles.menuNote}>
                <div>
                  <strong>Transportadoras configuradas</strong>
                  <p>
                    Agrega los nombres como deben verlos los clientes, los códigos que llegan desde Shopify y la URL principal de seguimiento.
                  </p>
                </div>
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={addCarrier}
                  disabled={loading}
                >
                  Agregar transportadora
                </button>
              </div>

              {configuration.shippingTracking.carriers.map((carrier, index) => (
                <div className={styles.menuNote} key={index}>
                  <div>
                    <div className={styles.grid}>
                      <label>
                        <span>Nombre visible</span>
                        <input
                          value={carrier.displayName}
                          onChange={(event) =>
                            updateCarrier(index, 'displayName', event.target.value)
                          }
                          placeholder="Ejemplo: Interrapidísimo"
                          disabled={loading}
                        />
                      </label>

                      <label>
                        <span>Códigos o nombres desde Shopify</span>
                        <input
                          value={carrier.aliases}
                          onChange={(event) =>
                            updateCarrier(index, 'aliases', event.target.value)
                          }
                          placeholder="Ejemplo: interrapidisimo_co, interrapidisimo"
                          disabled={loading}
                        />
                        <small>Separados por coma o salto de línea.</small>
                      </label>

                      <label>
                        <span>URL principal</span>
                        <input
                          value={carrier.trackingUrl}
                          onChange={(event) =>
                            updateCarrier(index, 'trackingUrl', event.target.value)
                          }
                          placeholder="https://www.transportadora.com"
                          disabled={loading}
                        />
                      </label>

                      <label>
                        <span>Activa</span>
                        <input
                          type="checkbox"
                          checked={carrier.isActive}
                          onChange={(event) =>
                            updateCarrier(index, 'isActive', event.target.checked)
                          }
                          disabled={loading}
                        />
                      </label>
                    </div>

                    <label>
                      <span>Instrucción específica</span>
                      <textarea
                        value={carrier.instructions}
                        onChange={(event) =>
                          updateCarrier(index, 'instructions', event.target.value)
                        }
                        placeholder="Ejemplo: Entra al enlace, busca Rastrea tu envío, copia la guía y consulta."
                        rows={3}
                        disabled={loading}
                      />
                    </label>
                  </div>

                  <button
                    type="button"
                    className={styles.secondary}
                    onClick={() => removeCarrier(index)}
                    disabled={loading}
                  >
                    Quitar
                  </button>
                </div>
              ))}
            </section>

          <section className={styles.card}>
            <div className={styles.sectionHeading}>
              <div>
                <p>5. BASE DE CONOCIMIENTO</p>
                <h2>Políticas que la IA debe consultar</h2>
              </div>
              <span>No inventa respuestas</span>
            </div>

            <label>
              <span>Términos y condiciones</span>
              <textarea
                value={configuration.knowledgeBase.termsConditions}
                onChange={(event) =>
                  updateKnowledge('termsConditions', event.target.value)
                }
                placeholder="Pega aquí condiciones generales, tiempos, restricciones, consentimiento, políticas de compra o reglas legales de la empresa."
                rows={5}
                maxLength={INSTRUCTION_LIMITS.termsConditions}
                disabled={loading}
              />
              <CharacterCounter
                value={configuration.knowledgeBase.termsConditions}
                limit={INSTRUCTION_LIMITS.termsConditions}
              />
            </label>

            <label>
              <span>Cambios y devoluciones</span>
              <textarea
                value={configuration.knowledgeBase.exchangesReturns}
                onChange={(event) =>
                  updateKnowledge('exchangesReturns', event.target.value)
                }
                placeholder="Ejemplo: Cambios dentro de 30 días, producto sin uso, con etiquetas, aplica o no aplica a promociones, quién paga el envío."
                rows={5}
                maxLength={INSTRUCTION_LIMITS.exchangesReturns}
                disabled={loading}
              />
              <CharacterCounter
                value={configuration.knowledgeBase.exchangesReturns}
                limit={INSTRUCTION_LIMITS.exchangesReturns}
              />
            </label>

            <label>
              <span>Garantías</span>
              <textarea
                value={configuration.knowledgeBase.warranties}
                onChange={(event) =>
                  updateKnowledge('warranties', event.target.value)
                }
                placeholder="Ejemplo: Tiempo de garantía, qué cubre, qué no cubre, cómo reportarla y cuándo debe pasar a un asesor."
                rows={5}
                maxLength={INSTRUCTION_LIMITS.warranties}
                disabled={loading}
              />
              <CharacterCounter
                value={configuration.knowledgeBase.warranties}
                limit={INSTRUCTION_LIMITS.warranties}
              />
            </label>

            <label>
              <span>Preguntas frecuentes y políticas adicionales</span>
              <textarea
                value={configuration.knowledgeBase.policiesFaq}
                onChange={(event) =>
                  updateKnowledge('policiesFaq', event.target.value)
                }
                placeholder="Horarios, rastreos, estados de pedidos, condiciones especiales, mensajes que debe usar o casos que debe escalar."
                rows={6}
                maxLength={INSTRUCTION_LIMITS.policiesFaq}
                disabled={loading}
              />
              <CharacterCounter
                value={configuration.knowledgeBase.policiesFaq}
                limit={INSTRUCTION_LIMITS.policiesFaq}
              />
            </label>
          </section>

          <section className={styles.card}>
            <div className={styles.sectionHeading}>
              <div>
                <p>6. INSTRUCCIONES ADICIONALES</p>
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
                maxLength={INSTRUCTION_LIMITS.aiInstructions}
                disabled={loading}
              />
              <CharacterCounter
                value={configuration.aiInstructions}
                limit={INSTRUCTION_LIMITS.aiInstructions}
              />
            </label>

            <div className={styles.help}>
              OpenAI razona con estas reglas y políticas de {companyName}. No son respuestas fijas: son la base aprobada para responder, vender y saber cuándo escalar.
            </div>
          </section>

          {hasExceededInstructionLimits ? (
            <div className={styles.limitError}>
              <strong>No se puede guardar todavía.</strong>
              {exceededInstructionFields.map((field) => (
                <span key={field.key}>
                  {field.label}: {formatCharacters(field.used)} utilizados de{' '}
                  {formatCharacters(field.limit)}.
                </span>
              ))}
            </div>
          ) : null}

          {message ? <p className={styles.message}>{message}</p> : null}

          <button
            className={styles.save}
            type="submit"
            disabled={loading || saving || hasExceededInstructionLimits}
          >
            {saving ? 'Guardando…' : 'Guardar configuración comercial'}
          </button>
        </form>
      </section>
    </main>
  );
}
