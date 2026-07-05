'use client';

import { useEffect, useState } from 'react';
import { AppSidebar } from '../../components/AppSidebar';
import styles from './page.module.css';

type Integration = {
  id?: string;
  key: string;
  provider: string;
  integrationType: string;
  name: string;
  description: string;
  status: 'pending' | 'active' | 'disconnected' | 'error';
  statusLabel: string;
  connectionReady: boolean;
  credentialMode: 'environment' | 'encrypted' | null;
  details: {
    displayName?: string | null;
    storeUrl?: string | null;
    apiVersion?: string | null;
    setupSource?: string | null;
  };
  connectedAt: string | null;
  updatedAt: string | null;
};

type ResponseData = {
  ok?: boolean;
  error?: string;
  company?: { name?: string };
  integrations?: Integration[];
};

function icon(key: string) {
  if (key === 'whatsapp') return '◉';
  if (key === 'shopify') return '⬡';
  if (key === 'instagram') return '◌';
  if (key === 'messenger') return '◍';
  return '◈';
}

export default function IntegracionesPage() {
  const [companyName, setCompanyName] = useState('Empresa');
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [shopDomain, setShopDomain] = useState('');
  const [connectingShopify, setConnectingShopify] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch('/api/integrations', {
          cache: 'no-store',
        });
        const data = (await response.json()) as ResponseData;

        if (!response.ok || !data.ok || !data.integrations) {
          throw new Error(data.error || 'No se pudieron cargar las integraciones.');
        }

        setCompanyName(data.company?.name || 'Empresa');
        setIntegrations(data.integrations);
        setSelectedKey(data.integrations[0]?.key || '');
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : 'No se pudieron cargar las integraciones.',
        );
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, []);

  const selected =
    integrations.find((integration) => integration.key === selectedKey) ??
    integrations[0];

  async function connectShopify() {
    const shop = shopDomain.trim();

    if (!shop) {
      setMessage('Escribe el dominio de Shopify, por ejemplo mitienda.myshopify.com.');
      return;
    }

    setMessage('');
    setConnectingShopify(true);

    try {
      const response = await fetch(
        `/api/integrations/shopify/connect?shop=${encodeURIComponent(shop)}`,
        { cache: 'no-store' },
      );
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        authorizationUrl?: string;
      };

      if (!response.ok || !data.ok || !data.authorizationUrl) {
        throw new Error(data.error || 'No se pudo iniciar la conexión con Shopify.');
      }

      window.location.assign(data.authorizationUrl);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'No se pudo iniciar la conexión con Shopify.',
      );
      setConnectingShopify(false);
    }
  }

  return (
    <main className={styles.shell}>
      <AppSidebar companyName={companyName} />
      <section className={styles.workspace}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>CONFIGURACIÓN</p>
            <h1>Canales e integraciones · {companyName}</h1>
            <p>
              Revisa el estado de los canales conectados a esta empresa. Las
              credenciales nunca se muestran aquí.
            </p>
          </div>
          <button
            type="button"
            className={styles.back}
            onClick={() => window.location.assign('/configuracion')}
          >
            ← Volver a configuración
          </button>
        </header>

        {message ? <p className={styles.error}>{message}</p> : null}

        <section className={styles.grid}>
          <div className={styles.cards}>
            {loading ? (
              <div className={styles.loading}>Cargando integraciones…</div>
            ) : (
              integrations.map((integration) => (
                <button
                  type="button"
                  key={integration.key}
                  className={`${styles.card} ${
                    selected?.key === integration.key ? styles.selected : ''
                  }`}
                  onClick={() => setSelectedKey(integration.key)}
                >
                  <span className={styles.icon}>{icon(integration.key)}</span>
                  <span className={styles.cardBody}>
                    <strong>{integration.name}</strong>
                    <small>{integration.description}</small>
                  </span>
                  <span
                    className={`${styles.status} ${
                      styles[`status_${integration.status}`]
                    }`}
                  >
                    {integration.statusLabel}
                  </span>
                </button>
              ))
            )}
          </div>

          {selected ? (
            <aside className={styles.detail}>
              <div className={styles.detailTop}>
                <span className={styles.largeIcon}>{icon(selected.key)}</span>
                <div>
                  <p className={styles.eyebrow}>INTEGRACIÓN</p>
                  <h2>{selected.name}</h2>
                  <span
                    className={`${styles.status} ${
                      styles[`status_${selected.status}`]
                    }`}
                  >
                    {selected.statusLabel}
                  </span>
                </div>
              </div>

              <p className={styles.description}>{selected.description}</p>

              <dl className={styles.details}>
                <div>
                  <dt>Estado</dt>
                  <dd>{selected.statusLabel}</dd>
                </div>
                <div>
                  <dt>Tipo</dt>
                  <dd>{selected.integrationType}</dd>
                </div>
                <div>
                  <dt>Origen de credenciales</dt>
                  <dd>{selected.details.setupSource || 'Sin configurar'}</dd>
                </div>
                {selected.details.displayName ? (
                  <div>
                    <dt>Nombre identificado</dt>
                    <dd>{selected.details.displayName}</dd>
                  </div>
                ) : null}
                {selected.details.storeUrl ? (
                  <div>
                    <dt>Tienda</dt>
                    <dd>{selected.details.storeUrl}</dd>
                  </div>
                ) : null}
                {selected.details.apiVersion ? (
                  <div>
                    <dt>Versión API</dt>
                    <dd>{selected.details.apiVersion}</dd>
                  </div>
                ) : null}
              </dl>

              {selected.key === 'shopify' && selected.status !== 'active' ? (
                <div className={styles.connectBox}>
                  <strong>Conectar una tienda Shopify</strong>
                  <p>
                    Escribe el dominio permanente de la tienda. Se abrirá Shopify
                    para que el propietario autorice el acceso.
                  </p>
                  <label htmlFor="shop-domain">Dominio Shopify</label>
                  <input
                    id="shop-domain"
                    value={shopDomain}
                    onChange={(event) => setShopDomain(event.target.value)}
                    placeholder="mitienda.myshopify.com"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    disabled={connectingShopify}
                  />
                  <button
                    type="button"
                    className={styles.connectButton}
                    onClick={() => void connectShopify()}
                    disabled={connectingShopify}
                  >
                    {connectingShopify ? 'Abriendo Shopify…' : 'Conectar Shopify'}
                  </button>
                  <small>
                    Las credenciales se autorizan en Shopify y no se muestran en Chat Pro.
                  </small>
                </div>
              ) : selected.status === 'active' ? (
                <div className={styles.notice}>
                  Esta integración está activa. Las credenciales permanecen protegidas.
                </div>
              ) : selected.connectionReady ? (
                <div className={styles.notice}>
                  Este canal tendrá un asistente de conexión guiado cuando su
                  proveedor quede habilitado.
                </div>
              ) : (
                <div className={styles.notice}>
                  Este conector aún no está disponible. Se muestra desde ahora
                  para que cada empresa pueda conocer los canales que se irán
                  habilitando.
                </div>
              )}
            </aside>
          ) : null}
        </section>
      </section>
    </main>
  );
}
