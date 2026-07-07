'use client';

import { FormEvent, useState } from 'react';
import styles from './page.module.css';

type Result = {
  ok?: boolean;
  error?: string;
  company?: { name?: string };
  product?: { title?: string; handle?: string; url?: string | null };
  variant?: {
    title?: string;
    sku?: string | null;
    price?: string;
    inventoryQuantity?: number | null;
    inventoryPolicy?: string;
    tracked?: boolean;
  };
  links?: { cartUrl?: string };
  note?: string;
};

export default function PruebaCommercePage() {
  const [handle, setHandle] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);

  async function runTest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);

    try {
      const response = await fetch('/api/integrations/shopify/commerce-preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle: handle.trim() }),
        cache: 'no-store',
      });

      const raw = await response.text();
      let data: Result | null = null;

      try {
        data = JSON.parse(raw) as Result;
      } catch {
        data = null;
      }

      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || raw.trim() || `La prueba falló (${response.status}).`);
      }

      setResult(data);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'No se pudo validar la venta por empresa.',
      );
    } finally {
      setLoading(false);
    }
  }

  const cartDomain = result?.links?.cartUrl
    ? new URL(result.links.cartUrl).hostname
    : '';

  return (
    <main className={styles.shell}>
      <section className={styles.workspace}>
        <p className={styles.eyebrow}>PRUEBA SEGURA · SHOPIFY POR EMPRESA</p>
        <h1>Validar producto, variante y carrito</h1>
        <p className={styles.intro}>
          Usa únicamente la empresa activa. No crea pedidos, no descuenta inventario y no envía mensajes.
        </p>

        <form className={styles.form} onSubmit={runTest}>
          <label>
            <span>Handle del producto (opcional)</span>
            <input
              value={handle}
              onChange={(event) => setHandle(event.target.value)}
              placeholder="Ejemplo: chaqueta-cuero"
              maxLength={160}
              autoCapitalize="none"
            />
            <small>Déjalo vacío para elegir una variante vendible automáticamente.</small>
          </label>
          <button type="submit" disabled={loading}>
            {loading ? 'Validando…' : 'Probar venta por empresa'}
          </button>
        </form>

        {error ? (
          <section className={styles.error} role="alert">
            <strong>No se pudo completar la prueba</strong>
            <p>{error}</p>
          </section>
        ) : null}

        {result?.ok ? (
          <section className={styles.result}>
            <p className={styles.success}>
              Validación completa para {result.company?.name || 'la empresa activa'}.
            </p>
            <div className={styles.grid}>
              <article>
                <span>Producto</span>
                <strong>{result.product?.title || 'Sin nombre'}</strong>
                <small>{result.product?.handle ? `/${result.product.handle}` : 'Sin handle'}</small>
              </article>
              <article>
                <span>Variante validada</span>
                <strong>{result.variant?.title || 'Variante única'}</strong>
                <small>{result.variant?.sku ? `SKU ${result.variant.sku}` : 'Sin SKU'}</small>
              </article>
              <article>
                <span>Inventario</span>
                <strong>{result.variant?.tracked ? String(result.variant.inventoryQuantity ?? 0) : 'No controlado'}</strong>
                <small>Política: {result.variant?.inventoryPolicy || 'Sin dato'}</small>
              </article>
              <article>
                <span>Tienda del carrito</span>
                <strong>{cartDomain || 'Sin dominio'}</strong>
                <small>Calculado con la conexión de la empresa activa.</small>
              </article>
            </div>
            <p className={styles.note}>{result.note || 'Prueba de solo lectura; no modificó Shopify.'}</p>
            {result.links?.cartUrl ? (
              <div className={styles.links}>
                <a href={result.links.cartUrl} target="_blank" rel="noreferrer">
                  Abrir carrito de prueba ↗
                </a>
              </div>
            ) : null}
          </section>
        ) : null}
      </section>
    </main>
  );
}
