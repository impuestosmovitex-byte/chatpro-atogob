'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AppSidebar } from '../../components/AppSidebar';
import styles from '../page.module.css';

type Settings = {
  notify_ready: boolean;
  notify_dispatched: boolean;
  notify_delivered: boolean;
  enabled_for_real_sending: boolean;
};

const defaults: Settings = {
  notify_ready: true,
  notify_dispatched: true,
  notify_delivered: true,
  enabled_for_real_sending: false,
};

export default function OrderNotificationSettingsPage() {
  const [settings, setSettings] = useState<Settings>(defaults);
  const [loading,setLoading] = useState(true);
  const [saving,setSaving] = useState(false);
  const [error,setError] = useState('');
  const [success,setSuccess] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/native-commerce/notifications/settings',{cache:'no-store'});
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'No se pudieron cargar las preferencias.');
      setSettings({...defaults,...result.settings,enabled_for_real_sending:false});
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Error al cargar la configuración.');
    } finally {
      setLoading(false);
    }
  },[]);

  useEffect(()=>{void reload();},[reload]);

  async function save() {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const response = await fetch('/api/native-commerce/notifications/settings',{
        method:'PATCH',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({
          notify_ready:settings.notify_ready,
          notify_dispatched:settings.notify_dispatched,
          notify_delivered:settings.notify_delivered,
        }),
      });
      const result=await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'No se pudo guardar.');
      setSettings({...defaults,...result.settings,enabled_for_real_sending:false});
      setSuccess('Preferencias guardadas. Los próximos cambios crearán vistas previas según tus elecciones.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible guardar.');
    } finally {
      setSaving(false);
    }
  }

  const choices: Array<{key:keyof Settings; title:string; description:string}> = [
    {key:'notify_ready',title:'Pedido listo',description:'Prepara un mensaje cuando el pedido esté listo para entrega o recogida.'},
    {key:'notify_dispatched',title:'Pedido despachado / en camino',description:'Para domicilio, indica que va en camino; para transportadora incluye empresa y guía.'},
    {key:'notify_delivered',title:'Pedido entregado',description:'Prepara un mensaje cuando el asesor marque la entrega como finalizada.'},
  ];

  return (
    <div className={styles.shell}>
      <AppSidebar companyName="Empresa"/>
      <main className={styles.main}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>MW1 COMERCIO · AUTOMATIZACIONES</p>
            <h1>Avisos de pedidos</h1>
            <p>Elige cuándo quieres preparar notificaciones para los clientes.</p>
            <p><Link href="/pedidos">← Volver a Pedidos</Link></p>
          </div>
        </header>
        <section className={styles.panel}>
          <h2>Notificaciones por estado</h2>
          <p className={styles.note}>Puedes activar o desactivar cada aviso para los próximos cambios de estado.</p>
          {choices.map(({key,title,description})=>(
            <label key={key} className={styles.notificationToggle}>
              <input type="checkbox" checked={Boolean(settings[key])} disabled={loading||saving}
                onChange={event=>setSettings(current=>({...current,[key]:event.target.checked}))}/>
              <span><strong>{title}</strong><small>{description}</small></span>
            </label>
          ))}
          <div className={styles.dispatchPanel}>
            <strong>Modo de pruebas: no se envían mensajes reales.</strong>
            <p className={styles.note}>Los avisos quedan guardados en el historial del pedido como vistas previas. Para enviarlos realmente por WhatsApp habrá que integrar la línea de cada empresa y utilizar las plantillas de Meta cuando correspondan.</p>
          </div>
          {error && <p role="alert" className={styles.error}>{error}</p>}
          {success && <p role="status">{success}</p>}
          <button type="button" className={styles.action} disabled={saving||loading} onClick={()=>void save()}>
            {saving ? 'Guardando…' : 'Guardar preferencias'}
          </button>
        </section>
      </main>
    </div>
  );
}
