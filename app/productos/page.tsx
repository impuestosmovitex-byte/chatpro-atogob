'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppSidebar } from '../components/AppSidebar';
import styles from './page.module.css';

type ProductItem = {
  id: string;
  title: string;
  handle: string;
  status: string;
  publishedAt: string | null;
  onlineStoreUrl: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
  totalInventory: number;
  tracksInventory: boolean;
  saleReady: boolean;
  variants: {
    total: number;
    shown: number;
    sellable: number;
    withoutStock: number;
    notTracked: number;
    hasMore: boolean;
  };
  previewVariants: Array<{
    legacyResourceId: string;
    title: string;
    sku: string | null;
    price: string;
    availableForSale: boolean;
    inventoryQuantity: number | null;
    tracked: boolean;
  }>;
};

type ProductsResponse = {
  ok?: boolean;
  error?: string;
  company?: {
    name?: string;
    slug?: string;
  };
  products?: ProductItem[];
  pageInfo?: {
    hasNextPage?: boolean;
    endCursor?: string | null;
  };
};

function statusLabel(status: string): string {
  if (status === 'ACTIVE') return 'Activo';
  if (status === 'DRAFT') return 'Borrador';
  if (status === 'ARCHIVED') return 'Archivado';
  if (status === 'UNLISTED') return 'No listado';
  return status || 'Sin estado';
}

function statusClass(status: string): string {
  if (status === 'ACTIVE') return styles.statusActive;
  if (status === 'DRAFT') return styles.statusDraft;
  if (status === 'ARCHIVED') return styles.statusArchived;
  if (status === 'UNLISTED') return styles.statusUnlisted;
  return styles.statusDefault;
}

export default function ProductosPage() {
  const [companyName, setCompanyName] = useState('Empresa');
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCursors, setPageCursors] = useState<Array<string | null>>([null]);
  const [pageInfo, setPageInfo] = useState({
    hasNextPage: false,
    endCursor: null as string | null,
  });
  const [appliedFilters, setAppliedFilters] = useState({
    search: '',
    status: 'all',
  });

  async function loadProducts(
    after: string | null,
    nextPageIndex: number,
    filters: { search: string; status: string },
  ) {
    setLoading(true);
    setMessage('');

    try {
      const params = new URLSearchParams();
      const normalizedSearch = filters.search.trim();

      if (normalizedSearch) {
        params.set('search', normalizedSearch);
      }

      if (filters.status !== 'all') {
        params.set('status', filters.status);
      }

      if (after) {
        params.set('after', after);
      }

      params.set('limit', '20');

      const response = await fetch(`/api/products?${params.toString()}`, {
        cache: 'no-store',
      });
      const data = (await response.json()) as ProductsResponse;

      if (!response.ok || !data.ok || !data.products || !data.pageInfo) {
        throw new Error(data.error || 'No se pudieron cargar los productos.');
      }

      setCompanyName(data.company?.name || 'Empresa');
      setProducts(data.products);
      setPageInfo({
        hasNextPage: Boolean(data.pageInfo.hasNextPage),
        endCursor: data.pageInfo.endCursor || null,
      });
      setPageIndex(nextPageIndex);
    } catch (error) {
      setProducts([]);
      setPageInfo({ hasNextPage: false, endCursor: null });
      setMessage(
        error instanceof Error
          ? error.message
          : 'No se pudieron cargar los productos.',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProducts(null, 0, { search: '', status: 'all' });
  }, []);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextFilters = { search, status };

    setAppliedFilters(nextFilters);
    setPageCursors([null]);
    void loadProducts(null, 0, nextFilters);
  }

  function clearFilters() {
    const nextFilters = { search: '', status: 'all' };

    setSearch(nextFilters.search);
    setStatus(nextFilters.status);
    setAppliedFilters(nextFilters);
    setPageCursors([null]);
    void loadProducts(null, 0, nextFilters);
  }

  function nextPage() {
    const cursor = pageInfo.endCursor;

    if (!cursor || loading) return;

    const nextIndex = pageIndex + 1;

    setPageCursors((current) =>
      current[nextIndex] ? current : [...current, cursor],
    );
    void loadProducts(cursor, nextIndex, appliedFilters);
  }

  function previousPage() {
    if (pageIndex === 0 || loading) return;

    const previousIndex = pageIndex - 1;
    void loadProducts(
      pageCursors[previousIndex] || null,
      previousIndex,
      appliedFilters,
    );
  }

  return (
    <main className={styles.shell}>
      <AppSidebar companyName={companyName} />

      <section className={styles.workspace}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>CATÁLOGO</p>
            <h1>Productos · {companyName}</h1>
            <p>
              Consulta el catálogo de la empresa activa. Esta vista solo lee
              Shopify y no modifica productos, inventario ni publicaciones.
            </p>
          </div>
        </header>

        <form className={styles.filters} onSubmit={applyFilters}>
          <label className={styles.searchField}>
            <span>Buscar</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Nombre, SKU, variante o referencia"
              maxLength={120}
            />
          </label>

          <label className={styles.statusField}>
            <span>Estado</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="all">Todos</option>
              <option value="active">Activos</option>
              <option value="draft">Borradores</option>
              <option value="archived">Archivados</option>
              <option value="unlisted">No listados</option>
            </select>
          </label>

          <div className={styles.filterActions}>
            <button type="submit" className={styles.searchButton} disabled={loading}>
              {loading ? 'Consultando…' : 'Buscar'}
            </button>
            <button
              type="button"
              className={styles.clearButton}
              onClick={clearFilters}
              disabled={loading}
            >
              Limpiar
            </button>
          </div>
        </form>

        {message ? <p className={styles.error}>{message}</p> : null}

        <section className={styles.summary}>
          <span>
            {loading
              ? 'Consultando Shopify…'
              : `${products.length} producto${products.length === 1 ? '' : 's'} en esta página`}
          </span>
          <small>
            Se muestran hasta 20 productos por página y hasta 5 variantes por
            producto.
          </small>
        </section>

        {loading ? (
          <div className={styles.loading}>Cargando catálogo de la empresa activa…</div>
        ) : products.length ? (
          <div className={styles.productGrid}>
            {products.map((product) => (
              <article className={styles.productCard} key={product.id}>
                <div className={styles.imageBox}>
                  {product.imageUrl ? (
                    <img
                      src={product.imageUrl}
                      alt={product.imageAlt || product.title}
                    />
                  ) : (
                    <span>Sin imagen</span>
                  )}
                </div>

                <div className={styles.productBody}>
                  <div className={styles.productTop}>
                    <div>
                      <h2>{product.title}</h2>
                      <small>
                        {product.handle ? `/${product.handle}` : 'Sin handle'}
                      </small>
                    </div>
                    <span className={`${styles.status} ${statusClass(product.status)}`}>
                      {statusLabel(product.status)}
                    </span>
                  </div>

                  <div className={styles.flags}>
                    <span className={product.publishedAt ? styles.flagGood : styles.flagWarn}>
                      {product.publishedAt
                        ? 'Publicado según Shopify'
                        : 'No publicado'}
                    </span>
                    <span className={product.onlineStoreUrl ? styles.flagGood : styles.flagWarn}>
                      {product.onlineStoreUrl ? 'Tiene URL pública' : 'Sin URL pública'}
                    </span>
                    <span
                      className={
                        product.variants.hasMore
                          ? styles.flagWarn
                          : product.saleReady
                            ? styles.flagReady
                            : styles.flagWarn
                      }
                    >
                      {product.variants.hasMore
                        ? 'Revisar más variantes'
                        : product.saleReady
                          ? 'Listo para venta'
                          : 'Revisar venta'}
                    </span>
                  </div>

                  <dl className={styles.metrics}>
                    <div>
                      <dt>Inventario</dt>
                      <dd>
                        {product.tracksInventory
                          ? product.totalInventory.toLocaleString('es-CO')
                          : 'No controlado'}
                      </dd>
                    </div>
                    <div>
                      <dt>Variantes revisadas</dt>
                      <dd>
                        {product.variants.shown}/{product.variants.total}
                      </dd>
                    </div>
                    <div>
                      <dt>Vendibles revisadas</dt>
                      <dd>{product.variants.sellable}</dd>
                    </div>
                    <div>
                      <dt>Sin stock revisadas</dt>
                      <dd>{product.variants.withoutStock}</dd>
                    </div>
                  </dl>

                  {product.previewVariants.length ? (
                    <div className={styles.variantPreview}>
                      <strong>Variantes revisadas</strong>
                      <ul>
                        {product.previewVariants.map((variant) => (
                          <li key={variant.legacyResourceId}>
                            <span>
                              {variant.title}
                              {variant.sku ? ` · SKU ${variant.sku}` : ''}
                            </span>
                            <small>
                              {variant.availableForSale ? 'Vendible' : 'No vendible'}
                              {variant.tracked
                                ? ` · Inventario ${variant.inventoryQuantity ?? 0}`
                                : ' · Inventario no controlado'}
                            </small>
                          </li>
                        ))}
                      </ul>
                      {product.variants.hasMore ? (
                        <small className={styles.variantNote}>
                          Hay más variantes. El detalle completo se agregará en
                          la siguiente fase.
                        </small>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className={styles.empty}>
            No se encontraron productos con estos filtros.
          </div>
        )}

        <nav className={styles.pagination} aria-label="Paginación de productos">
          <button
            type="button"
            onClick={previousPage}
            disabled={loading || pageIndex === 0}
          >
            ← Anterior
          </button>
          <span>Página {pageIndex + 1}</span>
          <button
            type="button"
            onClick={nextPage}
            disabled={loading || !pageInfo.hasNextPage || !pageInfo.endCursor}
          >
            Siguiente →
          </button>
        </nav>
      </section>
    </main>
  );
}
