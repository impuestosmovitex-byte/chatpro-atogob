'use client';

import {
  useEffect,
  useState,
} from 'react';

import styles from './page.module.css';

type InstagramConfig = {
  ok?: boolean;
  ready?: boolean;
  appId?: string;
  apiVersion?: string;
  scopes?: string[];
  loginMode?: string;
  missing?: string[];
  error?: string;
  message?: string;
};

export function InstagramConnectButton() {
  const [config, setConfig] =
    useState<InstagramConfig | null>(
      null,
    );

  const [loading, setLoading] =
    useState(true);

  const [
    connecting,
    setConnecting,
  ] = useState(false);

  const [message, setMessage] =
    useState('');

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const response =
          await fetch(
            '/api/integrations/instagram/config',
            {
              cache:
                'no-store',
            },
          );

        const data =
          (await response.json()) as
            InstagramConfig;

        if (active) {
          setConfig(data);
        }
      } catch {
        if (active) {
          setConfig({
            ready: false,
            message:
              'No se pudo consultar la configuración de Instagram.',
          });
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (
      !config?.ready ||
      typeof window ===
        'undefined'
    ) {
      return;
    }

    const url =
      new URL(
        window.location.href,
      );

    const code =
      url.searchParams
        .get(
          'instagram_code',
        )
        ?.trim() ||
      '';

    const returnedState =
      url.searchParams
        .get(
          'instagram_state',
        )
        ?.trim() ||
      '';

    const oauthError =
      url.searchParams
        .get(
          'instagram_error',
        )
        ?.trim() ||
      '';

    if (
      !code &&
      !oauthError
    ) {
      return;
    }

    url.searchParams.delete(
      'instagram_code',
    );

    url.searchParams.delete(
      'instagram_state',
    );

    url.searchParams.delete(
      'instagram_error',
    );

    window.history.replaceState(
      {},
      '',
      `${url.pathname}${url.search}${url.hash}`,
    );

    if (oauthError) {
      setMessage(oauthError);
      return;
    }

    const expectedState =
      window.sessionStorage.getItem(
        'chatpro_instagram_oauth_state',
      ) || '';

    window.sessionStorage.removeItem(
      'chatpro_instagram_oauth_state',
    );

    if (
      !returnedState ||
      !expectedState ||
      returnedState !==
        expectedState
    ) {
      setMessage(
        'Instagram regresó una autorización que no coincide con la solicitud iniciada en ChatPro.',
      );

      return;
    }

    const redirectUri =
      `${window.location.origin}/api/integrations/instagram/callback`;

    let cancelled = false;

    async function finishOAuth() {
      setConnecting(true);

      setMessage(
        'Validando y guardando Instagram…',
      );

      try {
        const response =
          await fetch(
            '/api/integrations/instagram/exchange-code',
            {
              method:
                'POST',
              headers: {
                'content-type':
                  'application/json',
              },
              body:
                JSON.stringify({
                  code,
                  redirectUri,
                }),
            },
          );

        const data =
          (await response.json()) as {
            ok?: boolean;
            message?: string;
            error?: string;
            instagram?: {
              username?: string;
              name?: string;
              accountType?: string;
            };
          };

        if (
          !response.ok ||
          !data.ok
        ) {
          throw new Error(
            data.message ||
              data.error ||
              'No se pudo completar la conexión de Instagram.',
          );
        }

        if (cancelled) {
          return;
        }

        const username =
          data.instagram
            ?.username
            ?.trim();

        setMessage(
          username
            ? `Instagram @${username} quedó conectado.`
            : data.message ||
                'Instagram quedó conectado.',
        );

        window.setTimeout(
          () =>
            window.location.reload(),
          900,
        );
      } catch (error) {
        if (!cancelled) {
          setMessage(
            error instanceof Error
              ? error.message
              : 'No se pudo completar la conexión de Instagram.',
          );
        }
      } finally {
        if (!cancelled) {
          setConnecting(false);
        }
      }
    }

    void finishOAuth();

    return () => {
      cancelled = true;
    };
  }, [config?.ready]);

  function startLogin() {
    if (
      !config?.ready ||
      !config.appId
    ) {
      setMessage(
        config?.message ||
          'Falta preparar Instagram en Meta.',
      );

      return;
    }

    setMessage('');

    const redirectUri =
      `${window.location.origin}/api/integrations/instagram/callback`;

    const state =
      crypto.randomUUID()
        .replace(
          /-/g,
          '',
        );

    window.sessionStorage.setItem(
      'chatpro_instagram_oauth_state',
      state,
    );

    const oauthUrl =
      new URL(
        'https://www.instagram.com/oauth/authorize',
      );

    oauthUrl.searchParams.set(
      'client_id',
      config.appId,
    );

    oauthUrl.searchParams.set(
      'redirect_uri',
      redirectUri,
    );

    oauthUrl.searchParams.set(
      'scope',
      config.scopes?.join(',') ||
        '',
    );

    oauthUrl.searchParams.set(
      'response_type',
      'code',
    );

    oauthUrl.searchParams.set(
      'state',
      state,
    );

    oauthUrl.searchParams.set(
      'force_reauth',
      'true',
    );

    window.location.assign(
      oauthUrl.toString(),
    );
  }

  return (
    <div
      className={
        styles.testBox
      }
    >
      <strong>
        Conectar Instagram
      </strong>

      <p>
        Conecta directamente una
        cuenta profesional de
        Instagram, ya sea Empresa o
        Creador. No necesita estar
        vinculada a una Página de
        Facebook.
      </p>

      <button
        type="button"
        className={
          styles.connectButton
        }
        onClick={() =>
          startLogin()
        }
        disabled={
          loading ||
          connecting ||
          !config?.ready
        }
      >
        {loading
          ? 'Revisando configuración…'
          : connecting
            ? 'Conectando Instagram…'
            : 'Conectar Instagram'}
      </button>

      <small>
        {config?.ready
          ? 'Instagram abrirá su autorización oficial. El token se procesa y guarda cifrado en el servidor y no se muestra en el navegador.'
          : config?.message ||
            (config?.missing?.length
              ? `Falta configurar: ${config.missing.join(', ')}`
              : 'Instagram todavía no está configurado.')}
      </small>

      {message ? (
        <p>{message}</p>
      ) : null}
    </div>
  );
}
