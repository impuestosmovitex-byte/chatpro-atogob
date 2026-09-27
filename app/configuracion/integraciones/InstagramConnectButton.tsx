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

type InstagramIntegration = {
  id?: string;
  key?: string;
  status:
    | 'pending'
    | 'active'
    | 'disconnected'
    | 'error';
  statusLabel?: string;
  details?: {
    displayName?: string | null;
    username?: string | null;
    profilePictureUrl?: string | null;
    accountType?: string | null;
    tokenExpiresAt?: string | null;
    apiVersion?: string | null;
    setupSource?: string | null;
  };
  health?: {
    status:
      | 'healthy'
      | 'error'
      | 'not_checked';
    statusLabel: string;
    checkedAt: string | null;
    error: string | null;
  };
};

type Props = {
  integration?:
    | InstagramIntegration
    | null;
};

export function InstagramConnectButton({
  integration,
}: Props) {
  const [
    config,
    setConfig,
  ] =
    useState<InstagramConfig | null>(
      null,
    );

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    connecting,
    setConnecting,
  ] =
    useState(false);

  const [
    testing,
    setTesting,
  ] =
    useState(false);

  const [
    disconnecting,
    setDisconnecting,
  ] =
    useState(false);

  const [
    message,
    setMessage,
  ] =
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
      ) ||
      '';

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

    let cancelled =
      false;

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
          700,
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

  async function testConnection() {
    setMessage('');
    setTesting(true);

    try {
      const response =
        await fetch(
          '/api/integrations/instagram/test',
          {
            method:
              'POST',
            cache:
              'no-store',
          },
        );

      const data =
        (await response.json()) as {
          ok?: boolean;
          message?: string;
          error?: string;
        };

      if (
        !response.ok ||
        !data.ok
      ) {
        throw new Error(
          data.message ||
            data.error ||
            'No se pudo verificar Instagram.',
        );
      }

      setMessage(
        data.message ||
          'Conexión de Instagram verificada.',
      );

      window.setTimeout(
        () =>
          window.location.reload(),
        650,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'No se pudo verificar Instagram.',
      );

      window.setTimeout(
        () =>
          window.location.reload(),
        1400,
      );
    } finally {
      setTesting(false);
    }
  }

  async function disconnectInstagram() {
    const confirmed =
      window.confirm(
        '¿Desconectar Instagram de ChatPro? La cuenta de Instagram no se elimina, pero ChatPro dejará de procesar sus mensajes hasta que la vuelvas a autorizar.',
      );

    if (!confirmed) {
      return;
    }

    setMessage('');
    setDisconnecting(true);

    try {
      const response =
        await fetch(
          '/api/integrations/instagram/disconnect',
          {
            method:
              'POST',
            cache:
              'no-store',
          },
        );

      const data =
        (await response.json()) as {
          ok?: boolean;
          message?: string;
          error?: string;
        };

      if (
        !response.ok ||
        !data.ok
      ) {
        throw new Error(
          data.message ||
            data.error ||
            'No se pudo desconectar Instagram.',
        );
      }

      setMessage(
        data.message ||
          'Instagram quedó desconectado.',
      );

      window.setTimeout(
        () =>
          window.location.reload(),
        650,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'No se pudo desconectar Instagram.',
      );
    } finally {
      setDisconnecting(false);
    }
  }

  const status =
    integration?.status ||
    'disconnected';

  const connected =
    status === 'active';

  const requiresReconnect =
    status === 'error';

  const hasConnection =
    connected ||
    requiresReconnect;

  const username =
    integration?.details
      ?.username
      ?.trim() ||
    '';

  const displayName =
    integration?.details
      ?.displayName
      ?.trim() ||
    '';

  const profilePictureUrl =
    integration?.details
      ?.profilePictureUrl
      ?.trim() ||
    '';

  const accountType =
    integration?.details
      ?.accountType
      ?.trim() ||
    '';

  const health =
    integration?.health;

  return (
    <div
      className={
        styles.testBox
      }
    >
      <strong>
        {connected
          ? 'Instagram conectado'
          : requiresReconnect
            ? 'Instagram requiere reconexión'
            : 'Conectar Instagram'}
      </strong>

      {hasConnection ? (
        <>
          <p>
            {connected
              ? 'ChatPro verificó la cuenta y las credenciales guardadas con Meta.'
              : health?.error ||
                'La conexión guardada ya no pudo verificarse correctamente con Meta.'}
          </p>

          <div
            style={{
              display:
                'flex',
              alignItems:
                'center',
              gap: 12,
              padding:
                '10px 0',
            }}
          >
            {profilePictureUrl ? (
              <img
                src={
                  profilePictureUrl
                }
                alt={
                  username
                    ? `@${username}`
                    : 'Instagram'
                }
                width={52}
                height={52}
                referrerPolicy="no-referrer"
                style={{
                  width: 52,
                  height: 52,
                  borderRadius:
                    '50%',
                  objectFit:
                    'cover',
                }}
              />
            ) : null}

            <div
              style={{
                display:
                  'grid',
                gap: 2,
              }}
            >
              <strong>
                {username
                  ? `@${username}`
                  : displayName ||
                    'Cuenta de Instagram'}
              </strong>

              {displayName &&
              (
                !username ||
                displayName.toLowerCase() !==
                  username.toLowerCase()
              ) ? (
                <small>
                  {displayName}
                </small>
              ) : null}

              {accountType ? (
                <small>
                  Cuenta profesional ·{' '}
                  {accountType ===
                  'CREATOR'
                    ? 'Creador'
                    : accountType ===
                        'BUSINESS'
                      ? 'Empresa'
                      : accountType}
                </small>
              ) : null}

              <small>
                {health?.statusLabel ||
                  'Sin verificar'}
              </small>
            </div>
          </div>

          <button
            type="button"
            className={
              styles.testButton
            }
            onClick={() =>
              void testConnection()
            }
            disabled={
              testing ||
              connecting ||
              disconnecting
            }
          >
            {testing
              ? 'Probando conexión…'
              : 'Probar conexión'}
          </button>

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
              testing ||
              disconnecting ||
              !config?.ready
            }
          >
            {connecting
              ? 'Reconectando Instagram…'
              : 'Reconectar Instagram'}
          </button>

          <button
            type="button"
            className={
              styles.testButton
            }
            onClick={() =>
              void disconnectInstagram()
            }
            disabled={
              disconnecting ||
              connecting ||
              testing
            }
          >
            {disconnecting
              ? 'Desconectando…'
              : 'Desconectar Instagram'}
          </button>
        </>
      ) : (
        <>
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
        </>
      )}

      <small>
        {config?.ready
          ? 'La autorización se realiza directamente con Instagram. Las credenciales se procesan y guardan cifradas en el servidor.'
          : config?.message ||
            (
              config?.missing
                ?.length
                ? `Falta configurar: ${config.missing.join(', ')}`
                : 'Instagram todavía no está configurado.'
            )}
      </small>

      {message ? (
        <p>{message}</p>
      ) : null}
    </div>
  );
}
