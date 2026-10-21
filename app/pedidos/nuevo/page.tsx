'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { AppSidebar } from '../../components/AppSidebar';
import styles from '../page.module.css';

type Product={
  id:string; name:string; sku:string|null; currency:string;
  base_price:number|string; available:boolean; published:boolean;
};
type Variant={
  id:string; product_id:string; sku:string|null; variant_label:string;
  unit:string; price:number|string; available:boolean; stock_quantity:number|null;
};
type Fulfillment='local_delivery'|'carrier'|'pickup';

const pesos=(n:number)=>new Intl.NumberFormat('es-CO',{
  style:'currency',currency:'COP',maximumFractionDigits:0,
}).format(n);

export default function NewNativeOrderPage() {
  const router=useRouter();
  const [products,setProducts]=useState<Product[]>([]);
  const [variants,setVariants]=useState<Variant[]>([]);
  const [quantities,setQuantities]=useState<Record<string,string>>({});
  const [customerName,setCustomerName]=useState('');
  const [customerPhone,setCustomerPhone]=useState('');
  const [deliveryAddress,setDeliveryAddress]=useState('');
  const [fulfillment,setFulfillment]=useState<Fulfillment>('local_delivery');
  const [customerNote,setCustomerNote]=useState('');
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const requestKeyRef=useRef<string|null>(null);

  const reload=useCallback(async()=>{
    setLoading(true);setError('');
    try{
      const [productRes,variantRes]=await Promise.all([
        fetch('/api/native-commerce/products',{cache:'no-store'}),
        fetch('/api/native-commerce/variants',{cache:'no-store'}),
      ]);
      const [p,v]=await Promise.all([productRes.json(),variantRes.json()]);
      if(!productRes.ok||!p.ok||!variantRes.ok||!v.ok){
        throw new Error(p.error||v.error||'No se pudo cargar el catálogo.');
      }
      setProducts((p.products||[]).filter((x:Product)=>x.published&&x.available));
      setVariants((v.variants||[]).filter((x:Variant)=>x.available));
    }catch(cause){
      setError(cause instanceof Error?cause.message:'No fue posible cargar los productos.');
    }finally{setLoading(false);}
  },[]);

  useEffect(()=>{void reload();},[reload]);
  const available=variants.filter(v=>products.some(p=>p.id===v.product_id));
  const items=available.map(v=>{
    const quantity=Number(quantities[v.id]||0);
    return {variant:v,product:products.find(p=>p.id===v.product_id)!,quantity};
  }).filter(x=>x.quantity>0);
  const subtotal=items.reduce((sum,x)=>sum+x.quantity*Number(x.variant.price),0);
  const quantitiesValid=items.every(x=>Number.isFinite(x.quantity)&&x.quantity<=1000&&
    Math.round(x.quantity*1000)===x.quantity*1000&&
    (x.variant.stock_quantity===null||x.quantity<=Number(x.variant.stock_quantity)));

  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    setError('');
    if(items.length===0||!quantitiesValid){
      setError('Selecciona productos y cantidades válidos según el inventario disponible.');
      return;
    }
    if(!customerName.trim()||!/^[+]?[0-9]{7,15}$/.test(customerPhone.trim())||
      (fulfillment!=='pickup'&&deliveryAddress.trim().length<5)){
      setError('Completa el nombre, teléfono y dirección cuando el pedido requiere entrega.');
      return;
    }
    setSaving(true);
    try{
      const requestKey=requestKeyRef.current??crypto.randomUUID();
      requestKeyRef.current=requestKey;
      const response=await fetch('/api/native-commerce/orders',{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({
          requestKey,customerName:customerName.trim(),customerPhone:customerPhone.trim(),
          deliveryAddress:deliveryAddress.trim(),fulfillmentMethod:fulfillment,
          customerNote:customerNote.trim(),
          items:items.map(x=>({variantId:x.variant.id,quantity:x.quantity})),
        }),
      });
      const result=await response.json();
      if(!response.ok||!result.ok)throw new Error(result.error||'No fue posible crear el pedido.');
      requestKeyRef.current=null;
      router.push('/pedidos?created='+encodeURIComponent(result.orderCode||''));
      router.refresh();
    }catch(cause){
      setError(cause instanceof Error?cause.message:'No se pudo guardar el pedido.');
    }finally{setSaving(false);}
  }

  return (
    <div className={styles.shell}>
      <AppSidebar companyName="MW1 Demo Supermercado"/>
      <main className={styles.main}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>MW1 COMERCIO · PEDIDOS</p>
            <h1>Crear pedido</h1>
            <p>Registra productos del catálogo y guarda el pedido directamente en MW1.</p>
            <p><Link href="/pedidos">← Volver a Pedidos</Link></p>
          </div>
        </header>
        <form onSubmit={event=>void save(event)}>
          <section className={styles.panel}>
            <h2>1. Datos del cliente</h2>
            <p className={styles.note}>En esta demo utiliza datos ficticios; no se enviarán mensajes.</p>
            <div className={styles.dispatchGrid}>
              <label>Nombre del cliente
                <input required minLength={2} maxLength={120} value={customerName}
                  onChange={e=>setCustomerName(e.target.value)} placeholder="Cliente de prueba"/>
              </label>
              <label>Teléfono ficticio
                <input required minLength={7} maxLength={16} value={customerPhone}
                  onChange={e=>setCustomerPhone(e.target.value)} placeholder="3000000000"/>
              </label>
              <label>Método de entrega
                <select value={fulfillment} onChange={e=>setFulfillment(e.target.value as Fulfillment)}>
                  <option value="local_delivery">Domicilio / reparto propio</option>
                  <option value="carrier">Envío por transportadora</option>
                  <option value="pickup">Recogida en tienda</option>
                </select>
              </label>
              {fulfillment!=='pickup'&&
                <label>Dirección de entrega
                  <input required minLength={5} maxLength={350} value={deliveryAddress}
                    onChange={e=>setDeliveryAddress(e.target.value)} placeholder="Dirección ficticia de pruebas"/>
                </label>
              }
              <label>Observaciones
                <input maxLength={500} value={customerNote}
                  onChange={e=>setCustomerNote(e.target.value)} placeholder="Instrucciones adicionales (opcional)"/>
              </label>
            </div>
          </section>
          <section className={styles.panel}>
            <div className={styles.toolbar}>
              <h2>2. Productos y cantidades</h2>
              <span className={styles.note}>{items.length} referencias seleccionadas</span>
            </div>
            {loading ? <p className={styles.empty}>Cargando catálogo…</p> :
              available.length===0 ? <p className={styles.empty}>
                No hay referencias disponibles. <Link href="/catalogo">Agregar producto al catálogo</Link>.
              </p>:
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead><tr><th>Producto</th><th>Referencia</th><th>Precio</th><th>Inventario</th><th>Cantidad</th></tr></thead>
                  <tbody>{available.map(v=>{
                    const product=products.find(p=>p.id===v.product_id);
                    return <tr key={v.id}>
                      <td><strong>{product?.name||'Producto'}</strong> · {v.variant_label}</td>
                      <td>{v.sku||'—'}</td>
                      <td>{pesos(Number(v.price))}</td>
                      <td>{v.stock_quantity===null?'Sin control':Number(v.stock_quantity)}</td>
                      <td><input type="number" min={0} max={1000} step={1}
                        style={{width:90,border:'1px solid #ddd',borderRadius:6,padding:'8px'}}
                        value={quantities[v.id]??''} placeholder="0"
                        onChange={e=>setQuantities(q=>({...q,[v.id]:e.target.value}))}
                      /></td>
                    </tr>;
                  })}</tbody>
                </table>
              </div>}
          </section>
          <section className={styles.panel}>
            <h2>3. Confirmar registro</h2>
            <p className={styles.note}>Subtotal estimado del catálogo (no incluye tarifas de envío).</p>
            <p className={styles.total}>{pesos(subtotal)}</p>
            <p className={styles.note}>El servidor recalcula los precios antes de registrar la orden. El pago queda pendiente y no se envía ningún WhatsApp.</p>
            {error&&<p className={styles.error} role="alert">{error}</p>}
            <button type="submit" className={styles.action} disabled={saving||loading||items.length===0}>
              {saving?'Guardando pedido…':'Crear pedido pendiente de confirmación'}
            </button>
          </section>
        </form>
      </main>
    </div>
  );
}
