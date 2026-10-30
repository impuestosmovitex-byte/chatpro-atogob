'use client';

import { useEffect, useRef, useState } from 'react';

type FBResponse = { status?: string; authResponse?: { code?: string } };
type FBSDK = {
  init(options: {appId: string; version: string; cookie: boolean; xfbml: boolean}): void;
  login(callback: (response: FBResponse) => void, options: Record<string, unknown>): void;
};
type MetaConfig = {ready?: boolean;appId?: string;configurationId?: string;apiVersion?: string;message?: string};

export default function MetaDiagnosisPage() {
  const [log, setLog] = useState<string[]>([]);
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const sdk = useRef<FBSDK | null>(null);
  const config = useRef<MetaConfig | null>(null);
  const add = (message: string) => setLog((old) => [...old.slice(-19), message]);

  useEffect(() => {
    let active = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const onMessage = (event: MessageEvent) => {
      if (!/^https:\/\/([a-z0-9-]+\.)*facebook\.com$/i.test(event.origin)) return;
      if (typeof event.data !== 'string' || !event.data.includes('WA_EMBEDDED_SIGNUP')) return;
      try {
        const parsed = JSON.parse(event.data) as {type?: string;event?: string};
        if (parsed.type === 'WA_EMBEDDED_SIGNUP') add('Evento oficial recibido: ' + String(parsed.event || 'sin nombre') + ' (identificadores omitidos)');
      } catch { add('Mensaje de Meta no interpretable'); }
    };
    window.addEventListener('message', onMessage);
    const load = async () => {
      try {
        const response = await fetch('/api/integrations/whatsapp/embedded/config', {cache: 'no-store'});
        if (!response.ok) throw new Error('Configuración no disponible (HTTP ' + response.status + ')');
        const data = await response.json() as MetaConfig;
        if (!data.ready || !data.appId || !data.configurationId || !data.apiVersion) throw new Error(data.message || 'La empresa piloto no está habilitada');
        config.current = data;
        add('Configuración piloto disponible; identificadores ocultos');
        const win = window as Window & {FB?: FBSDK;fbAsyncInit?: () => void};
        const initialize = () => {
          if (!active || !win.FB || !config.current) return;
          win.FB.init({appId: config.current.appId!, version: config.current.apiVersion!, cookie: false, xfbml: false});
          sdk.current = win.FB;
          setAvailable(true);
          add('SDK oficial cargado e inicializado');
          if (timeout) clearTimeout(timeout);
        };
        if (win.FB) { initialize(); return; }
        const script = document.createElement('script');
        script.src = 'https://connect.facebook.net/en_US/sdk.js';
        script.async = true;
        script.onerror = () => { if (active) setError('No se pudo cargar el SDK de Facebook'); };
        win.fbAsyncInit = initialize;
        document.body.appendChild(script);
        timeout = setTimeout(() => { if (active && !sdk.current) setError('El SDK no respondió en 15 segundos'); }, 15000);
      } catch (e) { if (active) setError(e instanceof Error ? e.message : 'Error de configuración'); }
    };
    void load();
    return () => {active = false;window.removeEventListener('message', onMessage);if (timeout) clearTimeout(timeout);};
  }, []);

  const launch = () => {
    if (!sdk.current || !config.current) return;
    setBusy(true);
    add('Clic reconocido: ' + String(navigator.userActivation?.isActive) + '; origen: ' + location.origin);
    let received = false;
    try {
      sdk.current.login((response) => {
        received = true;
        add('Facebook respondió: ' + (response.authResponse?.code ? 'código temporal presente (oculto)' : String(response.status || 'sin autorización')));
        setBusy(false);
      }, {
        config_id: config.current.configurationId,
        response_type: 'code',
        override_default_response_type: true,
        extras: {},
      });
      add('FB.login ejecutado sin excepción síncrona (callback pendiente)');
    } catch (e) {
      add('Excepción: ' + (e instanceof Error ? e.message : 'desconocida'));
      setBusy(false);
      return;
    }
    setTimeout(() => { if (!received) {add('Transcurrieron 15 segundos sin callback; verificar red/console de Meta');setBusy(false);} }, 15000);
  };

  return (
    <main style={{maxWidth:720,margin:'40px auto',padding:24,fontFamily:'system-ui',lineHeight:1.5}}>
      <h1>Diagnóstico aislado de Embedded Signup — MW1 staging</h1>
      <p>Solo para la empresa piloto. Esta página no guarda códigos, números, tokens ni activa webhooks.</p>
      <button type="button" onClick={launch} disabled={!available || busy} style={{padding:'12px 18px',cursor:'pointer'}}>
        {busy ? 'Esperando a Meta…' : available ? 'Probar apertura oficial de Meta' : 'Preparando SDK…'}
      </button>
      {error && <p role="alert" style={{color:'#b42318'}}>{error}</p>}
      <h2>Registro local sin credenciales</h2>
      <ol aria-live="polite">{log.map((item,i)=><li key={i}>{item}</li>)}</ol>
      <p><a href="/configuracion/integraciones">Regresar a integraciones</a></p>
    </main>
  );
}
