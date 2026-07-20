'use client';

import { useEffect, useState } from 'react';
import styles from './page.module.css';

type EmbeddedConfig = {
  ok?: boolean;
  ready?: boolean;
  appId?: string | null;
  configurationId?: string | null;
  apiVersion?: string;
  sessionInfoVersion?: string;
  flowVersion?: string;
  featureType?: string;
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
};

type FacebookSdk = {
  init(options: {
    appId: string;
    cookie: boolean;
    xfbml: boolean;
    version: string;
  }): void;
  login(
    callback: (response: FacebookLoginResponse) => void,
    options: Record<string, unknown>,
  ): void;
};

type FacebookWindow = Window & {
  FB?: FacebookSdk;
  fbAsyncInit?: () => void;
};

function loadFacebookSdk(appId: string, apiVersion: string): Promise<FacebookSdk> {
  return new Promise((resolve, reject) => {
    const target = window as FacebookWindow;
    const finish = () => {
      if (!target.FB) {
        reject(new Error('Meta no cargó su componente de conexión.'));
        return;
      }

      target.FB.init({ appId, cookie: true, xfbml: false, version: apiVersion });
      resolve(target.FB);
    };

    if (target.FB) {
      finish();
      return;
    }

    target.fbAsyncInit = finish;
    const existing = document.getElementById('facebook-jssdk');

    if (existing) return;

    const script = document.createElement('script');
    script.id = 'facebook-jssdk';
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.src = 'https://connect.facebook.net/es_LA/sdk.js';
    script.onerror = () => reject(new Error('No se pudo cargar la conexión de Meta.'));
    document.body.appendChild(script);
  });
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function WhatsappEmbeddedSignupButton() {
  const [config, setConfig] = useState<EmbeddedConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [message, setMessage] = useState('');

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

  async function connect() {
    if (
      !config?.ready ||
      !config.appId ||
      !config.configurationId ||
      !config.apiVersion
    ) {
      setMessage(config?.message || 'Falta preparar Embedded Signup en Meta.');
      return;
    }

    setMessage('');
    setConnecting(true);

    try {
      const sdk = await loadFacebookSdk(config.appId, config.apiVersion);

      await new Promise<void>((resolve, reject) => {
        let authCode = '';
        let session: SignupSession | null = null;
        let completing = false;
        let settled = false;

        const cleanup = () => {
          window.removeEventListener('message', listener);
          window.clearTimeout(timeout);
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
          if (
            event.origin !== 'https://www.facebook.com' &&
            event.origin !== 'https://web.facebook.com'
          ) {
            return;
          }

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

        const timeout = window.setTimeout(() => {
          fail(new Error('Meta no terminó la conexión dentro del tiempo esperado.'));
        }, 10 * 60 * 1000);

        window.addEventListener('message', listener);

        sdk.login(
          (response) => {
            authCode = text(response.authResponse?.code);

            if (!authCode) {
              fail(new Error('La autorización de Meta fue cancelada o no se completó.'));
              return;
            }

            void maybeComplete();
          },
          {
            config_id: config.configurationId,
            response_type: 'code',
            override_default_response_type: true,
            extras: {
              setup: {},
              featureType:
                config.featureType || 'whatsapp_business_app_onboarding',
              sessionInfoVersion: config.sessionInfoVersion || '3',
              version: config.flowVersion || 'v3',
            },
          },
        );
      });
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'No se pudo abrir la conexión oficial de Meta.',
      );
    } finally {
      setConnecting(false);
    }
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
        onClick={() => void connect()}
        disabled={loading || connecting || !config?.ready}
      >
        {loading
          ? 'Revisando configuración…'
          : connecting
            ? 'Conectando con Meta…'
            : 'Conectar WhatsApp con Meta'}
      </button>
      <small>
        {config?.ready
          ? 'Meta abrirá una ventana segura para seleccionar la cuenta y el número.'
          : config?.message || 'Embedded Signup todavía no está configurado.'}
      </small>
      {message ? <p>{message}</p> : null}
    </div>
  );
}
