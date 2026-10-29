'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './page.module.css';

type EmbeddedConfig = {
  ok?: boolean;
  ready?: boolean;
  appId?: string | null;
  configurationId?: string | null;
  apiVersion?: string;
  missing?: string[];
  message?: string;
  error?: string;
};

type SignupSession = {
  wabaId: string;
  phoneNumberId?: string;
  businessId?: string;
};

type FacebookLoginResponse = {
  authResponse?: { code?: string };
  status?: string;
};

type FacebookSdk = {
  init(options: {
    appId: string;
    cookie: boolean;
    xfbml: boolean;
    version: string;
    autoLogAppEvents?: boolean;
  }): void;
  getLoginStatus(callback: (response: FacebookLoginResponse) => void): void;
  login(
    callback: (response: FacebookLoginResponse) => void,
    options: Record<string, unknown>,
  ): void;
};

type FacebookWindow = Window & {
  FB?: FacebookSdk;
  fbAsyncInit?: () => void;
};

let facebookSdkPromise: Promise<FacebookSdk> | null = null;

function initializeFacebookSdk(
  sdk: FacebookSdk,
  appId: string,
  apiVersion: string,
) {
  sdk.init({
    appId,
    cookie: true,
    xfbml: true,
    autoLogAppEvents: true,
    version: apiVersion,
  });
}

function verifyFacebookSdk(
  sdk: FacebookSdk,
  appId: string,
  apiVersion: string,
): Promise<FacebookSdk> {
  return new Promise((resolve, reject) => {
    try {
      initializeFacebookSdk(sdk, appId, apiVersion);
      sdk.getLoginStatus(() => resolve(sdk));
    } catch (error) {
      reject(
        error instanceof Error
          ? error
          : new Error('Meta no pudo inicializar el SDK.'),
      );
    }
  });
}

function loadFacebookSdk(appId: string, apiVersion: string): Promise<FacebookSdk> {
  const target = window as FacebookWindow;

  if (target.FB) {
    return verifyFacebookSdk(target.FB, appId, apiVersion);
  }

  if (facebookSdkPromise) return facebookSdkPromise;

  facebookSdkPromise = new Promise((resolve, reject) => {
    let settled = false;

    const fail = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      facebookSdkPromise = null;
      reject(error || new Error('No se pudo cargar el SDK oficial de Meta.'));
    };

    const finish = () => {
      if (settled || !target.FB) return;

      void verifyFacebookSdk(target.FB, appId, apiVersion)
        .then((sdk) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          resolve(sdk);
        })
        .catch((error) => {
          fail(
            error instanceof Error
              ? error
              : new Error('Meta no pudo inicializar el SDK.'),
          );
        });
    };

    const timeout = window.setTimeout(() => {
      fail(new Error('Meta tardó demasiado en preparar el SDK.'));
    }, 15000);

    const previousAsyncInit = target.fbAsyncInit;
    target.fbAsyncInit = () => {
      previousAsyncInit?.();
      finish();
    };

    const existing = document.getElementById('facebook-jssdk') as HTMLScriptElement | null;
    if (existing) {
      if (target.FB) {
        finish();
        return;
      }
      existing.addEventListener('load', finish, { once: true });
      existing.addEventListener('error', () => fail(), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = 'facebook-jssdk';
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.src = 'https://connect.facebook.net/es_LA/sdk.js';
    script.addEventListener('load', finish, { once: true });
    script.addEventListener('error', () => fail(), { once: true });
    document.body.appendChild(script);
  });

  return facebookSdkPromise;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isMetaOrigin(origin: string): boolean {
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    return hostname === 'facebook.com' || hostname.endsWith('.facebook.com');
  } catch {
    return false;
  }
}

export function WhatsappEmbeddedSignupButton() {
  const [config, setConfig] = useState<EmbeddedConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [sdkReady, setSdkReady] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [message, setMessage] = useState('');
  const sdkRef = useRef<FacebookSdk | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const response = await fetch('/api/integrations/whatsapp/embedded/config', {
          cache: 'no-store',
        });
        const data = (await response.json()) as EmbeddedConfig;
        if (active) setConfig(data);
      } catch {
        if (active) {
          setConfig({
            ready: false,
            message: 'No se pudo consultar la configuración de Meta.',
          });
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    if (!config?.ready || !config.appId || !config.apiVersion) {
      sdkRef.current = null;
      setSdkReady(false);
      return () => {
        active = false;
      };
    }

    setMessage('Preparando conexión segura con Meta…');
    void loadFacebookSdk(config.appId, config.apiVersion)
      .then((sdk) => {
        if (!active) return;
        sdkRef.current = sdk;
        setSdkReady(true);
        setMessage('');
      })
      .catch((error) => {
        if (!active) return;
        sdkRef.current = null;
        setSdkReady(false);
        setMessage(
          error instanceof Error
            ? error.message
            : 'No se pudo preparar la conexión con Meta.',
        );
      });

    return () => {
      active = false;
    };
  }, [config?.ready, config?.appId, config?.apiVersion]);

  async function completeSignup(code: string, session: SignupSession) {
    const response = await fetch('/api/integrations/whatsapp/embedded/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code,
        wabaId: session.wabaId,
        phoneNumberId: session.phoneNumberId || '',
        businessId: session.businessId || '',
      }),
    });

    const data = (await response.json()) as {
      ok?: boolean;
      message?: string;
      error?: string;
    };

    if (!response.ok || !data.ok) {
      throw new Error(data.message || data.error || 'Meta no completó la conexión.');
    }

    setMessage(data.message || 'WhatsApp quedó conectado mediante Meta.');
    window.setTimeout(() => window.location.reload(), 1000);
  }

  function connect() {
    if (
      !config?.ready ||
      !config.appId ||
      !config.configurationId ||
      !config.apiVersion
    ) {
      setMessage(config?.message || 'Falta preparar Embedded Signup en Meta.');
      return;
    }

    const sdk = sdkRef.current;
    if (!sdk || !sdkReady) {
      setMessage('Meta todavía está cargando. Espera unos segundos y vuelve a intentar.');
      return;
    }

    setMessage('Abriendo Meta…');
    setConnecting(true);

    void new Promise<void>((resolve, reject) => {
      let authCode = '';
      let session: SignupSession | null = null;
      let completing = false;
      let settled = false;
      let callbackReceived = false;
      let metaEventReceived = false;

      const cleanup = () => {
        window.removeEventListener('message', listener);
        window.clearTimeout(timeout);
        window.clearTimeout(popupHint);
        cancelRef.current = null;
      };

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      const maybeComplete = async () => {
        if (!authCode || !session?.wabaId || completing || settled) return;
        completing = true;

        try {
          await completeSignup(authCode, session);
          settled = true;
          cleanup();
          resolve();
        } catch (error) {
          fail(
            error instanceof Error
              ? error
              : new Error('No se pudo terminar la conexión de WhatsApp.'),
          );
        }
      };

      const listener = (event: MessageEvent) => {
        if (!isMetaOrigin(event.origin)) return;
        if (typeof event.data !== 'string' || !event.data.trim().startsWith('{')) {
          return;
        }

        try {
          const payload = JSON.parse(event.data) as {
            type?: string;
            event?: string;
            data?: Record<string, unknown>;
          };

          if (payload.type !== 'WA_EMBEDDED_SIGNUP') return;
          metaEventReceived = true;

          if (payload.event === 'CANCEL') {
            fail(new Error('La ventana de Meta se cerró antes de autorizar el número.'));
            return;
          }

          if (payload.event === 'ERROR') {
            fail(
              new Error(
                text(payload.data?.error_message) ||
                  'Meta reportó un error durante la conexión.',
              ),
            );
            return;
          }

          if (
            payload.event === 'FINISH' ||
            payload.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'
          ) {
            const wabaId = text(payload.data?.waba_id);
            if (!wabaId) {
              fail(new Error('Meta terminó el proceso sin devolver la cuenta de WhatsApp.'));
              return;
            }

            session = {
              wabaId,
              phoneNumberId: text(payload.data?.phone_number_id) || undefined,
              businessId:
                text(payload.data?.business_id) ||
                text(payload.data?.businessId) ||
                undefined,
            };
            void maybeComplete();
          }
        } catch {
          // Meta también envía mensajes internos que no son JSON de sesión.
        }
      };

      const popupHint = window.setTimeout(() => {
        if (!settled && !callbackReceived && !metaEventReceived) {
          setMessage('El SDK de Facebook cargó, pero FB.login no devolvió respuesta ni abrió el flujo. Revisa en Meta Developers → Facebook Login for Business → Configuración que esté permitido Login with JavaScript SDK y el dominio de MW1.');
        }
      }, 8000);

      cancelRef.current = () => fail(new Error('Conexión cancelada. Puedes volver a intentarlo.'));

      const timeout = window.setTimeout(() => {
        if (!callbackReceived && !metaEventReceived) {
          fail(new Error('FB.login no devolvió respuesta. Revisa los dominios de JavaScript SDK y Facebook Login for Business en Meta Developers. No se modificó ningún número.'));
        } else if (!authCode && !session) {
          fail(new Error('Meta respondió, pero no completó la autorización. Revisa que la configuración Embedded Signup sea V4 y esté habilitada para esta aplicación.'));
        } else {
          fail(new Error('Meta inició el proceso, pero no devolvió todos los datos de autorización. Reintenta desde la empresa piloto.'));
        }
      }, 30000);

      window.addEventListener('message', listener);

      try {
        sdk.login(
          (response) => {
            callbackReceived = true;
            authCode = text(response.authResponse?.code);

            if (!authCode) {
              fail(new Error('La autorización de Meta fue cancelada o no se completó.'));
              return;
            }

            void maybeComplete();
          },
          {
            config_id: config.configurationId,
            auth_type: 'rerequest',
            response_type: 'code',
            override_default_response_type: true,
            extras: {
              setup: {},
            },
          },
        );
      } catch (error) {
        fail(
          error instanceof Error
            ? error
            : new Error('Meta no pudo abrir la ventana de conexión.'),
        );
      }
    })
      .catch((error) => {
        setMessage(
          error instanceof Error
            ? error.message
            : 'No se pudo abrir la conexión oficial de Meta.',
        );
      })
      .finally(() => {
        setConnecting(false);
      });
  }

  return (
    <div className={styles.testBox}>
      <strong>Conexión guiada con Meta</strong>
      <p>
        Abre el proceso oficial para autorizar una cuenta y un número de WhatsApp
        sin copiar tokens en Chat Pro.
      </p>
      <button
        type="button"
        className={styles.connectButton}
        onClick={connect}
        disabled={loading || connecting || !config?.ready || !sdkReady}
      >
        {loading
          ? 'Revisando configuración…'
          : !sdkReady && config?.ready
            ? 'Preparando Meta…'
            : connecting
              ? 'Conectando con Meta…'
              : 'Conectar WhatsApp con Meta'}
      </button>
      <small>
        {config?.ready
          ? sdkReady
            ? 'Meta está inicializado y abrirá una ventana segura para seleccionar la cuenta y el número.'
            : 'Preparando y verificando el SDK oficial de Meta…'
          : config?.message || 'Embedded Signup todavía no está configurado.'}
      </small>
      {connecting && <button type="button" className={styles.testButton} onClick={() => cancelRef.current?.()}>Cancelar intento</button>}
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}
