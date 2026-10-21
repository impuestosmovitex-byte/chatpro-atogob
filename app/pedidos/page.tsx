'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppSidebar } from '../components/AppSidebar';
import styles from './page.module.css';

type OrderStatus =
  | 'pending_confirmation' | 'confirmed' | 'preparing' | 'ready'
  | 'dispatched' | 'delivered' | 'cancelled';

type Order = {
  id: string;
  order_code: string;
  channel: string;
  status: OrderStatus;
  payment_status: string;
  fulfillment_method: 'local_delivery' | 'carrier' | 'pickup';
  currency: string;
  grand_total: number | string;
  created_at: string;
  updated_at: string;
};

type OrderDetail = {
  order: Order & {
    customer_snapshot?: { display_name?: string } | null;
    customer_note?: string;
    delivery_address?: Record<string, unknown>;
  };
  shipments: Array<{ id: string; carrier: string | null; tracking_number: string | null; status: string; dispatched_at: string | null }>;
  notifications: Array<{ id: string; event_type: string; message_body: string; status: string }>;
  items: Array<{
    id: string;
    product_name: string;
    variant_label: string | null;
    unit: string;
    quantity: number;
    unit_price: number;
    line_total: number;
  }>;
};

const labels: Record<OrderStatus, string> = {
  pending_confirmation: 'Por confirmar',
  confirmed: 'Confirmado',
  preparing: 'En preparación',
  ready: 'Listo',
  dispatched: 'Despachado',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
};

const nextStates: Partial<Record<OrderStatus, OrderStatus>> = {
  pending_confirmation: 'confirmed',
  confirmed: 'preparing',
  preparing: 'ready',
  ready: 'dispatched',
  dispatched: 'delivered',
};

function money(value: number | string, currency = 'COP'): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency', currency, maximumFractionDigits: 0,
  }).format(Number(value ?? 0));
}

export default function NativeOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [filter, setFilter] = useState('all');
  const [companyName, setCompanyName] = useState('Mi empresa');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [fulfillmentMethod, setFulfillmentMethod] = useState<'local_delivery' | 'carrier' | 'pickup'>('local_delivery');
  const [carrier, setCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/native-commerce/orders', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'No se pudieron cargar los pedidos.');
      setOrders(data.orders || []);
      setCompanyName(data.company?.name || 'Mi empresa');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ocurrió un error al cargar pedidos.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let cancelled = false;
    void (async () => {
      const response = await fetch(`/api/native-commerce/orders/${selectedId}`, { cache: 'no-store' });
      const data = await response.json();
      if (!cancelled) {
        if (response.ok && data.ok) { setDetail(data); setFulfillmentMethod(data.order?.fulfillment_method || 'local_delivery'); }
        else setError(data.error || 'No se pudo consultar el pedido.');
      }
    })().catch(() => {
      if (!cancelled) setError('No se pudo consultar el detalle del pedido.');
    });
    return () => { cancelled = true; };
  }, [selectedId, orders]);

  async function advance(order: Order) {
    const next = nextStates[order.status];
    if (!next || busy) return;
    if (next === 'dispatched') {
      setSelectedId(order.id);
      setFulfillmentMethod(order.fulfillment_method || 'local_delivery');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/native-commerce/orders/${order.id}/status`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedStatus: order.status, nextStatus: next }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'No se pudo cambiar el estado.');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar el pedido.');
    } finally {
      setBusy(false);
    }
  }

  async function dispatchOrder() {
    const order = orders.find(item => item.id === selectedId);
    if (!order || order.status !== 'ready' || busy) return;
    if (fulfillmentMethod === 'carrier' && (!carrier.trim() || !trackingNumber.trim())) {
      setError('Para enviar por transportadora, ingresa la empresa y el número de guía.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/native-commerce/orders/${order.id}/status`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          expectedStatus: 'ready',
          nextStatus: 'dispatched',
          fulfillmentMethod,
          carrier: fulfillmentMethod === 'carrier' ? carrier.trim() : null,
          trackingNumber: fulfillmentMethod === 'carrier' ? trackingNumber.trim() : null,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        throw new Error(result.error || 'No fue posible registrar el despacho.');
      }
      setCarrier('');
      setTrackingNumber('');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar el despacho.');
    } finally {
      setBusy(false);
    }
  }

  const shown = filter === 'all' ? orders : orders.filter(order => order.status === filter);
  const pending = orders.filter(order => order.status === 'pending_confirmation').length;
  const preparing = orders.filter(order => order.status === 'preparing').length;
  const paid = orders.filter(order => order.payment_status === 'paid').length;

  return (
    <div className={styles.shell}>
      <AppSidebar companyName={companyName} />
      <main className={styles.main}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>MW1 COMERCIO · ÁREA OPERATIVA</p>
            <h1>Pedidos</h1>
            <p><a href="/pedidos/nuevo"><strong>+ Crear pedido</strong></a> · <a href="/catalogo">Administrar catálogo →</a> · <a href="/pedidos/avisos">Configurar avisos automáticos →</a></p>
            <p>Organiza los pedidos que llegan por conversación, sin necesidad de una tienda virtual.</p>
          </div>
          <button className={styles.reload} type="button" onClick={() => void reload()} disabled={loading}>
            {loading ? 'Actualizando…' : 'Actualizar'}
          </button>
        </header>

        <section className={styles.metrics} aria-label="Resumen de pedidos">
          <div><span>Pedidos registrados</span><strong>{orders.length}</strong></div>
          <div><span>Por confirmar</span><strong>{pending}</strong></div>
          <div><span>En preparación</span><strong>{preparing}</strong></div>
          <div><span>Pagados</span><strong>{paid}</strong></div>
        </section>

        <section className={styles.panel}>
          <div className={styles.toolbar}>
            <h2>Listado de pedidos</h2>
            <label>Estado
              <select value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="all">Todos</option>
                {Object.entries(labels).map(([key, value]) => <option key={key} value={key}>{value}</option>)}
              </select>
            </label>
          </div>
          {error && <p className={styles.error} role="alert">{error}</p>}
          {loading && orders.length === 0 ? <p className={styles.empty}>Cargando pedidos…</p> :
            shown.length === 0 ? <p className={styles.empty}>No hay pedidos en este estado.</p> : (
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead><tr>
                    <th>Pedido</th><th>Fecha</th><th>Canal</th><th>Estado</th>
                    <th>Pago</th><th>Total</th><th>Operación</th>
                  </tr></thead>
                  <tbody>{shown.map(order => (
                    <tr key={order.id}>
                      <td><button className={styles.link} onClick={() => setSelectedId(order.id)}>{order.order_code}</button></td>
                      <td>{new Date(order.created_at).toLocaleString('es-CO')}</td>
                      <td>{order.channel}</td>
                      <td><span className={styles.status}>{labels[order.status] || order.status}</span></td>
                      <td><span className={order.payment_status === 'paid' ? styles.paid : styles.unpaid}>
                        {order.payment_status === 'paid' ? 'Pagado' : order.payment_status === 'unpaid' ? 'Sin pagar' : order.payment_status}
                      </span></td>
                      <td>{money(order.grand_total, order.currency)}</td>
                      <td>{nextStates[order.status] ?
                        <button type="button" disabled={busy} className={styles.action} onClick={() => void advance(order)}>
                          {nextStates[order.status] === 'dispatched' ? 'Registrar despacho' : labels[nextStates[order.status] as OrderStatus]}
                        </button> : <span className={styles.muted}>Finalizado</span>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
        </section>

        {selectedId && (
          <section className={styles.panel} aria-label="Detalle del pedido">
            <div className={styles.toolbar}>
              <h2>Detalle · {detail?.order.order_code || 'Cargando…'}</h2>
              <button className={styles.reload} onClick={() => setSelectedId(null)} type="button">Cerrar</button>
            </div>
            {!detail ? <p>Cargando información…</p> : <>
              <p><strong>Pago:</strong> {detail.order.payment_status === 'paid' ? 'Confirmado' : 'Sin confirmar'} · <strong>Estado:</strong> {labels[detail.order.status]}</p>
              <div className={styles.tableScroll}><table className={styles.table}>
                <thead><tr><th>Producto</th><th>Cantidad</th><th>Precio</th><th>Subtotal</th></tr></thead>
                <tbody>{detail.items.map(item =>
                  <tr key={item.id}><td>{item.product_name} {item.variant_label || ''}</td><td>{item.quantity} {item.unit}</td><td>{money(item.unit_price)}</td><td>{money(item.line_total)}</td></tr>
                )}</tbody>
              </table></div>
              <p className={styles.total}>Total: {money(detail.order.grand_total, detail.order.currency)}</p>
              <p className={styles.note}>{detail.order.customer_note || 'Sin observaciones.'}</p>
              {detail.order.status === 'ready' && (
                <div className={styles.dispatchPanel}>
                  <h3>Registrar entrega o despacho</h3>
                  <p className={styles.note}>Selecciona cómo se entregará el pedido. Si utilizas una transportadora, la guía y la empresa son obligatorias.</p>
                  <div className={styles.dispatchGrid}>
                    <label>Método de entrega
                      <select value={fulfillmentMethod} onChange={event => setFulfillmentMethod(event.target.value as typeof fulfillmentMethod)}>
                        <option value="local_delivery">Domicilio / repartidor propio</option>
                        <option value="carrier">Transportadora con número de guía</option>
                        <option value="pickup">Recogida en tienda</option>
                      </select>
                    </label>
                    {fulfillmentMethod === 'carrier' && (
                      <>
                        <label>Empresa transportadora
                          <input required maxLength={100} placeholder="Ejemplo: Interrapidísimo" value={carrier} onChange={event => setCarrier(event.target.value)} />
                        </label>
                        <label>Número de guía
                          <input required maxLength={120} placeholder="Ingresa el número de guía" value={trackingNumber} onChange={event => setTrackingNumber(event.target.value)} />
                        </label>
                      </>
                    )}
                  </div>
                  <button type="button" className={styles.action} disabled={busy} onClick={() => void dispatchOrder()}>
                    {busy ? 'Guardando…' : 'Confirmar despacho y preparar aviso'}
                  </button>
                </div>
              )}
              {(detail.shipments || []).length > 0 && (
                <div className={styles.dispatchPanel}>
                  <h3>Información del envío</h3>
                  {(detail.shipments || []).map(ship => (
                    <p key={ship.id}>{ship.carrier || 'Entrega'}{ship.tracking_number ? ` · Guía: ${ship.tracking_number}` : ''}
                      {' · '}{ship.status === 'delivered' ? 'Entregado' : 'Despachado'}</p>
                  ))}
                </div>
              )}
              {(detail.notifications || []).length > 0 && (
                <div className={styles.dispatchPanel}>
                  <h3>Avisos automáticos preparados</h3>
                  <p className={styles.note}>Estas son vistas previas de los mensajes para el cliente. La demo no envía WhatsApp reales.</p>
                  {(detail.notifications || []).map(notification => (
                    <div className={styles.notificationPreview} key={notification.id}>
                      <strong>{notification.event_type === 'preparing' ? 'Pedido en preparación' : notification.event_type === 'ready' ? 'Pedido listo' : notification.event_type === 'dispatched' ? 'Enviado / en camino' : 'Pedido entregado'}</strong>
                      <p>{notification.message_body}</p>
                      <small>Estado: {notification.status === 'preview' ? 'Vista previa, sin enviar' : notification.status}</small>
                    </div>
                  ))}
                </div>
              )}
            </>}
          </section>
        )}
        <p className={styles.disclaimer}>Los pagos no se confirman manualmente. Los avisos se generan en modo vista previa; todavía no se envían mensajes reales.</p>
      </main>
    </div>
  );
}
