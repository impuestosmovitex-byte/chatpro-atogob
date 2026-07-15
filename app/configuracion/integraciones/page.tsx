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
    phoneNumberId?: string | null;
    businessAccountId?: string | null;
    setupSource?: string | null;
  };
  health?: {
    status: 'healthy' | 'error' | 'not_checked';
    statusLabel: string;
    checkedAt: string | null;
    error: string | null;
    verifiedName: string | null;
    displayPhoneNumber: string | null;
    qualityRating: string | null;
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


type CatalogCount = {
  count: number;
  precision: string;
};

type CatalogDiagnostics = {
  counts: {
    totalProducts: CatalogCount;
    statuses: {
      active: CatalogCount;
      draft: CatalogCount;
      archived: CatalogCount;
      unlisted: CatalogCount;
    };
    onlineStore: {
      published: CatalogCount;
    };
    inventory: {
      withStock: CatalogCount;
      withoutStock: CatalogCount;
      notTracked: CatalogCount;
    };
  };
  scan: {
    scannedProducts: number;
    hasMoreProducts: boolean;
    reportedVariantsInScannedProducts: number;
    readVariants: number;
    sellableVariants: number;
    nonSellableVariants: number;
    productsWithUnreadVariants: number;
  };
  products: Array<{
    id: string;
    title: string;
    handle: string;
    status: string;
    onlineStorePublished: boolean;
    hasPublicUrl: boolean;
    totalInventory: number;
    tracksInventory: boolean;
    saleReady: boolean;
    variants: {
      total: number;
      read: number;
      sellable: number;
      nonSellable: number;
      withStock: number;
      withoutStock: number;
      notTracked: number;
      hasMore: boolean;
    };
    reasons: string[];
    note: string | null;
  }>;
};

function formatCatalogCount(value: CatalogCount): string {
  const suffix = value.precision === 'AT_LEAST' ? '+' : '';
  return `${value.count.toLocaleString('es-CO')}${suffix}`;
}

function catalogStatusLabel(status: string): string {
  if (status === 'ACTIVE') return 'Activo';
  if (status === 'DRAFT') return 'Borrador';
  if (status === 'ARCHIVED') return 'Archivado';
  if (status === 'UNLISTED') return 'No listado';
  return status;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Sin verificar';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sin verificar';

  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function icon(key: string) {
  if (key === 'whatsapp') return '◉';
  if (key === 'shopify') return '⬡';
  if (key === 'instagram') return '◌';
  if (key === 'messenger') return '◍';
  if (key === 'meta-ads') return '◇';
  return '◈';
}

export default function IntegracionesPage() {
  const [companyName, setCompanyName] = useState('Empresa');
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [shopDomain, setShopDomain] = useState('');
  const [whatsappForm, setWhatsappForm] = useState({
    phoneNumberId: '',
    accessToken: '',
    apiVersion: 'v25.0',
    displayName: '',
    businessAccountId: '',
  });
  const [whatsappTestPhone, setWhatsappTestPhone] = useState('');
  const [connectingWhatsapp, setConnectingWhatsapp] = useState(false);
  const [testingWhatsapp, setTestingWhatsapp] = useState(false);
  const [connectingShopify, setConnectingShopify] = useState(false);
  const [testingShopify, setTestingShopify] = useState(false);
  const [shopifyTest, setShopifyTest] = useState<{
    shopName: string;
    shopDomain: string;
    productCount: number;
  } | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [catalogProducts, setCatalogProducts] = useState<Array<{
    id: string;
    title: string;
    handle: string;
    imageUrl: string | null;
    variants: Array<{ title: string; price: string }>;
  }> | null>(null);
  const [catalogDiagnostics, setCatalogDiagnostics] =
    useState<CatalogDiagnostics | null>(null);

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

  async function testShopify() {
    setMessage('');
    setShopifyTest(null);
    setTestingShopify(true);

    try {
      const response = await fetch('/api/integrations/shopify/test', {
        method: 'POST',
        cache: 'no-store',
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        shop?: { name?: string; domain?: string };
        products?: { count?: number };
      };

      if (!response.ok || !data.ok || !data.shop || !data.products) {
        throw new Error(data.error || 'La prueba de Shopify no fue exitosa.');
      }

      setShopifyTest({
        shopName: data.shop.name || 'Tienda Shopify',
        shopDomain: data.shop.domain || '',
        productCount: data.products.count || 0,
      });
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'No se pudo probar la conexión Shopify.',
      );
    } finally {
      setTestingShopify(false);
    }
  }

  async function configureWhatsapp() {
    if (!whatsappForm.phoneNumberId.trim() || !whatsappForm.accessToken.trim()) {
      setMessage('Escribe Phone Number ID y access token de Meta.');
      return;
    }

    setMessage('');
    setConnectingWhatsapp(true);

    try {
      const response = await fetch('/api/integrations/whatsapp/configure', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(whatsappForm),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
      };

      if (!response.ok || !data.ok) {
        throw new Error(data.message || data.error || 'No se pudo conectar WhatsApp.');
      }

      setMessage(data.message || 'WhatsApp conectado correctamente.');
      window.setTimeout(() => window.location.reload(), 900);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'No se pudo conectar WhatsApp.',
      );
    } finally {
      setConnectingWhatsapp(false);
    }
  }

  async function testWhatsapp() {
    if (!whatsappTestPhone.trim()) {
      setMessage('Escribe un teléfono de prueba con indicativo de país.');
      return;
    }

    setMessage('');
    setTestingWhatsapp(true);

    try {
      const response = await fetch('/api/integrations/whatsapp/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to: whatsappTestPhone }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
      };

      if (!response.ok || !data.ok) {
        throw new Error(data.message || data.error || 'No se pudo enviar la prueba.');
      }

      setMessage(data.message || 'Prueba enviada por WhatsApp.');
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'No se pudo enviar la prueba.',
      );
    } finally {
      setTestingWhatsapp(false);
    }
  }

  async function previewCatalog() {
    setMessage('');
    setCatalogProducts(null);
    setCatalogDiagnostics(null);
    setLoadingCatalog(true);

    try {
      const response = await fetch(
        '/api/integrations/shopify/catalog-preview',
        {
          method: 'POST',
          cache: 'no-store',
        },
      );
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        products?: Array<{
          id: string;
          title: string;
          handle: string;
          imageUrl: string | null;
          variants: Array<{ title: string; price: string }>;
        }>;
        diagnostics?: CatalogDiagnostics;
      };

      if (!response.ok || !data.ok || !data.products) {
        throw new Error(data.error || 'No se pudo cargar el catálogo.');
      }

      setCatalogProducts(data.products);
      setCatalogDiagnostics(data.diagnostics || null);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'No se pudo cargar el catálogo.',
      );
    } finally {
      setLoadingCatalog(false);
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
                  <dt>Disponibilidad</dt>
                  <dd>
                    {selected.connectionReady
                      ? 'Disponible para conexión guiada'
                      : 'Pendiente de habilitar'}
                  </dd>
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
                {selected.details.phoneNumberId ? (
                  <div>
                    <dt>Phone Number ID</dt>
                    <dd>{selected.details.phoneNumberId}</dd>
                  </div>
                ) : null}
                {selected.details.businessAccountId ? (
                  <div>
                    <dt>Business Account ID</dt>
                    <dd>{selected.details.businessAccountId}</dd>
                  </div>
                ) : null}
              </dl>

              {selected.key === 'whatsapp' && selected.id ? (
                <div className={styles.testBox}>
                  <strong>
                    Estado técnico de Meta:{' '}
                    {selected.health?.statusLabel || 'Sin verificar'}
                  </strong>
                  <p>
                    {selected.health?.status === 'healthy'
                      ? 'El token, el Phone Number ID y los permisos fueron aceptados por Meta.'
                      : selected.health?.error ||
                        'Todavía no se ha comprobado esta conexión con Meta.'}
                  </p>
                  {selected.health?.verifiedName ? (
                    <span>Nombre verificado: {selected.health.verifiedName}</span>
                  ) : null}
                  {selected.health?.displayPhoneNumber ? (
                    <span>Número: {selected.health.displayPhoneNumber}</span>
                  ) : null}
                  {selected.health?.qualityRating ? (
                    <span>Calidad: {selected.health.qualityRating}</span>
                  ) : null}
                  <small>
                    Última verificación:{' '}
                    {formatDateTime(selected.health?.checkedAt)}
                  </small>
                  <button
                    type="button"
                    className={styles.testButton}
                    onClick={() => window.location.reload()}
                  >
                    Verificar ahora
                  </button>
                </div>
              ) : null}

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
              ) : selected.key === 'shopify' && selected.status === 'active' ? (
                <div className={styles.testBox}>
                  <strong>Verificar conexión</strong>
                  <p>
                    Comprueba que Chat Pro puede leer los datos básicos de esta
                    tienda usando el token protegido.
                  </p>
                  <button
                    type="button"
                    className={styles.testButton}
                    onClick={() => void testShopify()}
                    disabled={testingShopify}
                  >
                    {testingShopify ? 'Probando conexión…' : 'Probar conexión'}
                  </button>
                  {shopifyTest ? (
                    <div className={styles.testResult}>
                      <strong>Conexión verificada</strong>
                      <span>{shopifyTest.shopName}</span>
                      <span>{shopifyTest.shopDomain}</span>
                      <span>{shopifyTest.productCount} productos detectados</span>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className={styles.catalogButton}
                    onClick={() => void previewCatalog()}
                    disabled={loadingCatalog}
                  >
                    {loadingCatalog ? 'Cargando catálogo…' : 'Ver primeros productos'}
                  </button>
                  {catalogProducts ? (
                    <div className={styles.catalogPreview}>
                      <div className={styles.catalogPreviewTitle}>
                        <strong>Diagnóstico del catálogo</strong>
                        <span>
                          {catalogDiagnostics
                            ? 'Consulta realizada a Shopify'
                            : 'Vista básica del catálogo'}
                        </span>
                      </div>

                      {catalogDiagnostics ? (
                        <>
                          <div className={styles.catalogMetrics}>
                            <div>
                              <small>Productos</small>
                              <strong>
                                {formatCatalogCount(
                                  catalogDiagnostics.counts.totalProducts,
                                )}
                              </strong>
                            </div>
                            <div>
                              <small>Publicados online</small>
                              <strong>
                                {formatCatalogCount(
                                  catalogDiagnostics.counts.onlineStore.published,
                                )}
                              </strong>
                            </div>
                            <div>
                              <small>Con inventario</small>
                              <strong>
                                {formatCatalogCount(
                                  catalogDiagnostics.counts.inventory.withStock,
                                )}
                              </strong>
                            </div>
                          </div>

                          <div className={styles.catalogPills}>
                            <span>
                              Activos{' '}
                              <b>
                                {formatCatalogCount(
                                  catalogDiagnostics.counts.statuses.active,
                                )}
                              </b>
                            </span>
                            <span>
                              Borradores{' '}
                              <b>
                                {formatCatalogCount(
                                  catalogDiagnostics.counts.statuses.draft,
                                )}
                              </b>
                            </span>
                            <span>
                              Archivados{' '}
                              <b>
                                {formatCatalogCount(
                                  catalogDiagnostics.counts.statuses.archived,
                                )}
                              </b>
                            </span>
                            <span>
                              No listados{' '}
                              <b>
                                {formatCatalogCount(
                                  catalogDiagnostics.counts.statuses.unlisted,
                                )}
                              </b>
                            </span>
                            <span>
                              Sin stock{' '}
                              <b>
                                {formatCatalogCount(
                                  catalogDiagnostics.counts.inventory.withoutStock,
                                )}
                              </b>
                            </span>
                            <span>
                              Inventario no controlado{' '}
                              <b>
                                {formatCatalogCount(
                                  catalogDiagnostics.counts.inventory.notTracked,
                                )}
                              </b>
                            </span>
                          </div>

                          <p className={styles.catalogScope}>
                            Se analizaron{' '}
                            {catalogDiagnostics.scan.scannedProducts.toLocaleString(
                              'es-CO',
                            )}{' '}
                            productos recientes y{' '}
                            {catalogDiagnostics.scan.readVariants.toLocaleString(
                              'es-CO',
                            )}{' '}
                            variantes.{' '}
                            {catalogDiagnostics.scan.hasMoreProducts
                              ? 'Hay más productos en Shopify que se revisarán desde la futura página Productos.'
                              : 'El diagnóstico incluye todos los productos encontrados.'}
                          </p>

                          {catalogDiagnostics.products.length ? (
                            <div className={styles.catalogDiagnosis}>
                              <strong>Motivo por producto</strong>
                              <ul className={styles.diagnosticList}>
                                {catalogDiagnostics.products.map((product) => (
                                  <li key={product.id}>
                                    <div className={styles.diagnosticTop}>
                                      <span>
                                        <b>{product.title}</b>
                                        <small>
                                          {catalogStatusLabel(product.status)} ·{' '}
                                          {product.variants.sellable}/
                                          {product.variants.total} variantes
                                          vendibles
                                        </small>
                                      </span>
                                      <em
                                        className={
                                          product.saleReady
                                            ? styles.diagnosticReady
                                            : styles.diagnosticBlocked
                                        }
                                      >
                                        {product.saleReady
                                          ? 'Disponible'
                                          : 'Revisar'}
                                      </em>
                                    </div>
                                    <ul className={styles.reasonList}>
                                      {product.reasons.map((reason) => (
                                        <li key={reason}>{reason}</li>
                                      ))}
                                    </ul>
                                    {product.note ? (
                                      <small className={styles.diagnosticNote}>
                                        {product.note}
                                      </small>
                                    ) : null}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </>
                      ) : null}

                      <div className={styles.availableProducts}>
                        <strong>Primeros productos disponibles</strong>
                        {catalogProducts.length ? (
                          <ul>
                            {catalogProducts.map((product) => (
                              <li key={product.id}>
                                <span>{product.title}</span>
                                <small>
                                  {product.variants.length} variante
                                  {product.variants.length === 1 ? '' : 's'}
                                  {product.variants[0]
                                    ? ` · $${product.variants[0].price}`
                                    : ''}
                                </small>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span>
                            No se encontraron productos activos, publicados y
                            vendibles. Revisa el diagnóstico anterior.
                          </span>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : selected.key === 'whatsapp' ? (
                <div className={styles.connectBox}>
                  <strong>
                    {selected.status === 'active'
                      ? 'WhatsApp Business conectado'
                      : selected.status === 'error'
                        ? 'Revisar conexión de WhatsApp'
                        : 'Conectar WhatsApp Business'}
                  </strong>
                  <p>
                    Usa los datos de Meta Developers / WhatsApp Business.
                    El token se guarda cifrado y nunca se muestra en Chat Pro.
                  </p>

                  <label htmlFor="wa-phone-id">Phone Number ID</label>
                  <input
                    id="wa-phone-id"
                    value={whatsappForm.phoneNumberId}
                    onChange={(event) =>
                      setWhatsappForm((current) => ({
                        ...current,
                        phoneNumberId: event.target.value,
                      }))
                    }
                    placeholder="Ejemplo: 123456789012345"
                    disabled={connectingWhatsapp}
                  />

                  <label htmlFor="wa-token">Access token permanente</label>
                  <input
                    id="wa-token"
                    type="password"
                    value={whatsappForm.accessToken}
                    onChange={(event) =>
                      setWhatsappForm((current) => ({
                        ...current,
                        accessToken: event.target.value,
                      }))
                    }
                    placeholder="Pega el token de Meta"
                    disabled={connectingWhatsapp}
                  />

                  <label htmlFor="wa-version">Versión Graph API</label>
                  <input
                    id="wa-version"
                    value={whatsappForm.apiVersion}
                    onChange={(event) =>
                      setWhatsappForm((current) => ({
                        ...current,
                        apiVersion: event.target.value,
                      }))
                    }
                    placeholder="v25.0"
                    disabled={connectingWhatsapp}
                  />

                  <label htmlFor="wa-display">Nombre visible opcional</label>
                  <input
                    id="wa-display"
                    value={whatsappForm.displayName}
                    onChange={(event) =>
                      setWhatsappForm((current) => ({
                        ...current,
                        displayName: event.target.value,
                      }))
                    }
                    placeholder="Ejemplo: WhatsApp principal"
                    disabled={connectingWhatsapp}
                  />

                  <label htmlFor="wa-business">Business Account ID opcional</label>
                  <input
                    id="wa-business"
                    value={whatsappForm.businessAccountId}
                    onChange={(event) =>
                      setWhatsappForm((current) => ({
                        ...current,
                        businessAccountId: event.target.value,
                      }))
                    }
                    placeholder="Ejemplo: 9876543210"
                    disabled={connectingWhatsapp}
                  />

                  <button
                    type="button"
                    className={styles.connectButton}
                    onClick={() => void configureWhatsapp()}
                    disabled={connectingWhatsapp}
                  >
                    {connectingWhatsapp ? 'Guardando WhatsApp…' : 'Guardar conexión WhatsApp'}
                  </button>

                  <small>
                    En Meta configura el webhook público terminado en
                    /webhook/whatsapp y usa el verify token definido en Railway.
                  </small>

                  {selected.status === 'active' ? (
                    <div className={styles.testBox}>
                      <strong>Enviar prueba</strong>
                      <p>
                        Envía un mensaje real al número indicado para validar
                        token, Phone Number ID y permisos.
                      </p>
                      <label htmlFor="wa-test-phone">Teléfono con indicativo</label>
                      <input
                        id="wa-test-phone"
                        value={whatsappTestPhone}
                        onChange={(event) => setWhatsappTestPhone(event.target.value)}
                        placeholder="Ejemplo: 573001234567"
                        disabled={testingWhatsapp}
                      />
                      <button
                        type="button"
                        className={styles.testButton}
                        onClick={() => void testWhatsapp()}
                        disabled={testingWhatsapp}
                      >
                        {testingWhatsapp ? 'Enviando prueba…' : 'Enviar prueba'}
                      </button>
                    </div>
                  ) : null}
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
