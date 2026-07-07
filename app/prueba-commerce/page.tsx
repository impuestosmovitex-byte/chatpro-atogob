'use client';

import { FormEvent, useState } from 'react';

type Preview = {
  ok?: boolean;
  error?: string;
  company?: { name?: string };
  product?: { title?: string; handle?: string; url?: string };
  variant?: {
    title?: string;
    sku?: string | null;
    price?: string;
    inventoryQuantity?: number | null;
    inventoryPolicy?: string;
    tracked?: boolean;
  };
  links?: { cartUrl?: string; checkoutUrl?: string };
  note?: string;
};

export default function PruebaCommercePage() {
  const [handle, setHandle] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<Preview | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    setResult(null);

    try {
      const response = await fetch(
        '/api/integrations/shopify/commerce-preview',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ handle }),
          cache: 'no-store',
        },
      );
      const data = (await response.json()) as Preview;

      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'No se pudo ejecutar la prueba.');
      }

      setResult(data);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'No se pudo ejecutar la prueba.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 760, margin: '40px auto', padding: 20 }}>
      <p style={{ fontWeight: 800, letterSpacing: '0.08em' }}>
        PRUEBA SEGURA · SHOPIFY POR EMPRESA
      </p>
      <h1>Validar producto, variante y carrito</h1>
      <p>
        Esta prueba usa únicamente la empresa activa de tu sesión. No crea
        pedidos, no descuenta inventario y no envía mensajes.
      </p>

      <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          Handle del producto (opcional)
          <input
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            placeholder="Ejemplo: chaqueta-cuero"
            maxLength={160}
            autoCapitalize="none"
            style={{ minHeight: 40, padding: '0 10px' }}
          />
        </label>
        <button type="submit" disabled={loading} style={{ minHeight: 42 }}>
          {loading ? 'Validando…' : 'Probar venta por empresa'}
        </button>
      </form>

      {message ? (
        <p style={{ marginTop: 18, color: '#a03434' }}>{message}</p>
      ) : null}

      {result?.ok ? (
        <section style={{ marginTop: 22, display: 'grid', gap: 10 }}>
          <strong>Prueba completada para {result.company?.name || 'Empresa'}.</strong>
          <div><b>Producto:</b> {result.product?.title} {result.product?.handle ? `· /${result.product.handle}` : ''}</div>
          <div><b>Variante:</b> {result.variant?.title || 'Única'}{result.variant?.sku ? ` · SKU ${result.variant.sku}` : ''}</div>
          <div><b>Precio:</b> {result.variant?.price || 'Sin dato'}</div>
          <div><b>Inventario:</b> {result.variant?.tracked ? result.variant?.inventoryQuantity ?? 0 : 'No controlado'} · Política {result.variant?.inventoryPolicy || 'Sin dato'}</div>
          <p>{result.note}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {result.product?.url ? <a href={result.product.url} target="_blank" rel="noreferrer">Ver producto ↗</a> : null}
            {result.links?.cartUrl ? <a href={result.links.cartUrl} target="_blank" rel="noreferrer">Abrir carrito de prueba ↗</a> : null}
            {result.links?.checkoutUrl ? <a href={result.links.checkoutUrl} target="_blank" rel="noreferrer">Abrir enlace de pago ↗</a> : null}
          </div>
        </section>
      ) : null}
    </main>
  );
}
