'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppSidebar } from '../components/AppSidebar';
import styles from '../pedidos/page.module.css';

type Method = { id:string; provider:string; label:string; method:string; enabled:boolean; status:string };
type PaymentResponse = { ok?:boolean; options?:Method[]; checkoutEnabled?:boolean; error?:string };

export default function PaymentsPage(){
  const [data,setData]=useState<PaymentResponse|null>(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    const controller=new AbortController();
    fetch('/api/native-commerce/payment-methods',{cache:'no-store',signal:controller.signal})
      .then(async response=>{
        const payload=await response.json() as PaymentResponse;
        if(!response.ok || !payload.ok)throw new Error(payload.error||'No se pudo consultar la configuración.');
        setData(payload);
      }).catch(reason=>{
        if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'Error de conexión.');
      }).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[]);

  return <div className={styles.shell}>
    <AppSidebar companyName="Empresa"/>
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>MW1 COMERCIO · MEDIOS DE PAGO</p>
          <h1>Medios de pago</h1>
          <p>Los pagos de los compradores deberán llegar directamente a la cuenta de tu empresa.</p>
          <p><Link href="/pedidos">← Volver a pedidos</Link></p>
        </div>
      </header>
      <section className={styles.panel}>
        <h2>Integraciones disponibles próximamente</h2>
        <p className={styles.note}>Ninguna pasarela está habilitada para cobros en este entorno. No ingreses claves privadas, credenciales bancarias ni datos de tarjetas aquí.</p>
        {loading && <p role="status">Consultando métodos…</p>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
        {!loading && !error && data && <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead><tr><th>Medio de pago</th><th>Proveedor</th><th>Estado</th></tr></thead>
            <tbody>{(data.options||[]).map(option=><tr key={option.id}>
              <td>{option.label}</td>
              <td>{option.provider.replace(/_/g,' ')}</td>
              <td>{option.enabled?'Habilitado':'Pendiente de integración segura'}</td>
            </tr>)}</tbody>
          </table>
        </div>}
        {!loading && data && !data.checkoutEnabled && <p className={styles.note}>
          El checkout está deshabilitado hasta verificar la cuenta del comercio, los webhooks y la conciliación de cada proveedor.
        </p>}
      </section>
    </main>
  </div>;
}
