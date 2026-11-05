'use client';

import { useCallback, useEffect, useState } from 'react';
import styles from '../page.module.css';

type EmbeddedConfig = {
  ok?: boolean;
  ready?: boolean;
  authorizationEnabled?: boolean;
  connectionEnabled?: boolean;
  appId?: string | null;
  configurationId?: string | null;
  apiVersion?: string;
  message?: string;
  error?: string;
};

export function WhatsappCoexistencePilotDiagnostics() {
  const [config, setConfig] = useState<EmbeddedConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [popupResult, setPopupResult] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    setConfig(null);
    try {
      const response = await fetch('/api/integrations/whatsapp/embedded/config', {
        method: 'GET', cache: 'no-store',
      });
      const body = await response.json() as EmbeddedConfig;
      if (!response.ok || body.ok !== true) {
        throw new Error(body.error || 'No fue posible consultar el diagnóstico.');
      }
      setConfig(body);
    } catch {
      setError('No se pudo verificar la configuración. Revisa la sesión de la empresa piloto.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  function testBrowserPopup() {
    // Blank local popup only. No Meta SDK, login, code, token, phone or cookies.
    let popup: Window | null = null;
    try {
      popup = window.open('about:blank', '_blank', 'width=280,height=170');
      if (!popup) {
        setPopupResult('Bloqueada: el navegador impidió la ventana emergente.');
        return;
      }
      popup.close();
      setPopupResult('Permitida: el navegador abrió y cerró una ventana vacía de prueba.');
    } catch {
      setPopupResult('La prueba de ventanas no fue autorizada por el navegador.');
      try { popup?.close(); } catch { /* ignore */ }
    }
  }

  const embeddedReady = config?.ready === true &&
    Boolean(config.appId) && Boolean(config.configurationId);
  const checks = [
    {
      label: 'Sesión de la empresa piloto',
      value: config ? 'Verificada por la API' : 'Pendiente de comprobar',
    },
    {
      label: 'Configuración general de Embedded Signup',
      value: loading ? 'Verificando' : embeddedReady
        ? 'Configurada para el piloto convencional'
        : 'Incompleta o deshabilitada',
    },
    {
      label: 'SDK de Meta y ventanas emergentes',
      value: popupResult || 'Prueba local opcional pendiente',
    },
    {
      label: 'Modalidad coexistencia validada por Meta',
      value: 'No verificada: requiere configuración y número piloto',
    },
    {
      label: 'Recepción de mensajes y webhooks',
      value: 'Deshabilitada para este diagnóstico',
    },
    {
      label: 'Sincronización autorizada de historial y contactos',
      value: 'No iniciada: requiere aprobación explícita y conexión verificada',
    },
  ];

  return (
    <div className={styles.testBox}>
      <strong>Estado del entorno de prueba (solo lectura)</strong>
      <p>
        La disponibilidad general de Embedded Signup no significa que
        coexistencia esté habilitada. Esta prueba jamás realiza FB.login,
        intercambia tokens ni escribe integraciones.
      </p>
      {error ? <p role="alert">{error}</p> : null}
      <dl className={styles.details} aria-live="polite">
        {checks.map(check => (
          <div key={check.label}>
            <dt>{check.label}</dt>
            <dd>{check.value}</dd>
          </div>
        ))}
      </dl>
      {config?.message ? <small>{config.message}</small> : null}
      {config?.connectionEnabled === true ? (
        <p role="alert">
          La API reportó conexión convencional habilitada. Esta página sigue
          siendo solo de diagnóstico; no se permite activar coexistencia aquí.
        </p>
      ) : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button type="button" className={styles.testButton}
          disabled={loading} onClick={() => void refresh()}>
          {loading ? 'Verificando…' : 'Actualizar diagnóstico'}
        </button>
        <button type="button" className={styles.catalogButton} onClick={testBrowserPopup}>
          Comprobar ventanas del navegador
        </button>
      </div>
      <small>
        No selecciones aquí un número operativo de ATOGOB ni MAOGO.
        La conexión de WhatsApp Business App + MW1 se habilitará únicamente
        mediante un flujo separado, tras verificar Meta y el número de prueba.
      </small>
    </div>
  );
}
