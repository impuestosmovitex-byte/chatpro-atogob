'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AppSidebar } from '../components/AppSidebar';
import styles from '../pedidos/page.module.css';

type Product = { id: string; name: string; sku: string | null; base_price: number; currency: string; available: boolean; published: boolean };
type CatalogResponse = { ok: boolean; error?: string; products?: Product[] };
const formatMoney = (price: number, currency = 'COP') =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency, maximumFractionDigits: 0 }).format(price);

export default function CatalogPage() {
  const [items, setItems] = useState<Product[]>([]);
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/native-commerce/products', { cache: 'no-store' });
      const payload = (await response.json()) as CatalogResponse;
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'No fue posible consultar el catálogo.');
      setItems(payload.products ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Error al cargar los productos.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSuccess('');
    const parsedPrice = Number(price);
    const parsedStock = stock.trim() === '' ? null : Number(stock);
    if (!name.trim() || !sku.trim() || !Number.isFinite(parsedPrice) || parsedPrice < 0 ||
        (parsedStock !== null && (!Number.isFinite(parsedStock) || parsedStock < 0))) {
      setError('Revisa los datos del producto.'); return;
    }
    setSaving(true);
    try {
      const response = await fetch('/api/native-commerce/products', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), sku: sku.trim(), price: parsedPrice, stock: parsedStock }),
      });
      const result = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || 'No se pudo crear el producto.');
      setName(''); setSku(''); setPrice(''); setStock('');
      setSuccess('Producto agregado a este catálogo.');
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Error al guardar.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.shell}>
      <AppSidebar companyName="Empresa" />
      <main className={styles.main}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>MW1 COMERCIO · CATÁLOGO NATIVO</p>
            <h1>Catálogo</h1>
            <p>Registra productos para vender por conversación, incluso sin tienda online.</p>
            <p><Link href="/catalogo/importar"><strong>Importar catálogo →</strong></Link> · <Link href="/catalogo/fichas"><strong>Fichas de productos →</strong></Link> · <Link href="/catalogo/imagenes"><strong>Fotografías de productos →</strong></Link> · <Link href="/pedidos">Ver pedidos →</Link></p>
          </div>
          <button type="button" className={styles.reload} disabled={loading} onClick={() => void reload()}>
            {loading ? 'Cargando…' : 'Actualizar'}
          </button>
        </header>
        <section className={styles.panel}>
          <h2>Agregar producto manualmente</h2>
          <form onSubmit={(event) => void save(event)}
            style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', marginTop: 16 }}>
            <label>Nombre<br /><input required maxLength={180} value={name} onChange={e => setName(e.target.value)} placeholder="Pan artesanal" /></label>
            <label>SKU<br /><input required maxLength={64} value={sku} onChange={e => setSku(e.target.value)} placeholder="PAN-001" /></label>
            <label>Precio COP<br /><input required min={0} step="0.01" type="number" value={price} onChange={e => setPrice(e.target.value)} /></label>
            <label>Inventario (opcional)<br /><input min={0} step="0.001" type="number" value={stock} onChange={e => setStock(e.target.value)} placeholder="Sin control" /></label>
            <button type="submit" className={styles.action} disabled={saving}>{saving ? 'Guardando…' : 'Agregar producto'}</button>
          </form>
          {error && <p className={styles.error} role="alert">{error}</p>}
          {success && <p role="status">{success}</p>}
        </section>
        <section className={styles.panel}>
          <div className={styles.toolbar}><h2>Productos ({items.length})</h2></div>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead><tr><th>SKU</th><th>Producto</th><th>Precio</th><th>Publicado</th></tr></thead>
              <tbody>{items.map(item => (
                <tr key={item.id}>
                  <td>{item.sku || '—'}</td><td>{item.name}</td><td>{formatMoney(Number(item.base_price), item.currency)}</td>
                  <td>{item.published ? 'Sí' : 'No'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {!loading && !items.length && <p className={styles.empty}>Todavía no hay productos.</p>}
        </section>
        <p className={styles.disclaimer}>Importación de PDF, Excel y tiendas conectadas: en desarrollo. No conectar catálogos reales todavía.</p>
      </main>
    </div>
  );
}
