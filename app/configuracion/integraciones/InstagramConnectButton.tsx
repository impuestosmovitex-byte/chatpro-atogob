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
  missing?: string[];
  error?: string;
  message?: string;
};

type InstagramAccount = {
  pageId: string;
  pageName: string;
  instagramId: string;
  username?: string;
  name?: string;
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

  const [accounts, setAccounts] =
    useState<InstagramAccount[]>([]);

  const [
    accessToken,
    setAccessToken,
  ] = useState('');

  const [
    selectedInstagramId,
    setSelectedInstagramId,
  ] = useState('');

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const response =
          await fetch(
            '/api/integrations/instagram/config',
            {
              cache: 'no-store',
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
      typeof window === 'undefined'
    ) {
      return;
    }

    const url =
      new URL(window.location.href);

    const code =
      url.searchParams
        .get('instagram_code')
        ?.trim() || '';

    const returnedState =
      url.searchParams
        .get('instagram_state')
        ?.trim() || '';

    const oauthError =
      url.searchParams
        .get('instagram_error')
        ?.trim() || '';

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
      returnedState !== expectedState
    ) {
      setMessage(
        'Meta regresó una autorización que no coincide con la solicitud iniciada en ChatPro.',
      );

      return;
    }

    const redirectUri =
      `${window.location.origin}/api/integrations/instagram/callback`;

    let cancelled = false;

    async function finishOAuth() {
      setConnecting(true);

      setMessage(
        'Validando autorización con Meta…',
      );

      try {
        const response =
          await fetch(
            '/api/integrations/instagram/exchange-code',
            {
              method: 'POST',
              headers: {
                'content-type':
                  'application/json',
              },
              body: JSON.stringify({
                code,
                redirectUri,
              }),
            },
          );

        const data =
          (await response.json()) as {
            ok?: boolean;
            accessToken?: string;
            message?: string;
            error?: string;
          };

        if (
          !response.ok ||
          !data.ok ||
          !data.accessToken
        ) {
          throw new Error(
            data.message ||
              data.error ||
              'No se pudo completar la autorización de Meta.',
          );
        }

        if (cancelled) {
          return;
        }

        setAccessToken(
          data.accessToken,
        );

        await discoverAccounts(
          data.accessToken,
        );
      } catch (error) {
        if (!cancelled) {
          setMessage(
            error instanceof Error
              ? error.message
              : 'No se pudo completar la conexión con Meta.',
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

  async function discoverAccounts(
    token: string,
  ) {
    const response =
      await fetch(
        '/api/integrations/instagram/discover',
        {
          method: 'POST',
          headers: {
            'content-type':
              'application/json',
          },
          body: JSON.stringify({
            accessToken: token,
          }),
        },
      );

    const data =
      (await response.json()) as {
        ok?: boolean;
        accounts?: InstagramAccount[];
        message?: string;
        error?: string;
      };

    if (
      !response.ok ||
      !data.ok ||
      !data.accounts
    ) {
      throw new Error(
        data.message ||
          data.error ||
          'No se pudieron consultar las cuentas de Instagram.',
      );
    }

    if (!data.accounts.length) {
      throw new Error(
        'Meta no devolvió ninguna cuenta profesional de Instagram vinculada a una Página autorizada.',
      );
    }

    setAccounts(
      data.accounts,
    );

    if (
      data.accounts.length === 1
    ) {
      setSelectedInstagramId(
        data.accounts[0].instagramId,
      );
    }

    setMessage(
      data.accounts.length === 1
        ? `Encontramos la cuenta @${data.accounts[0].username || data.accounts[0].name || 'Instagram'}. Confirma la conexión.`
        : 'Selecciona la cuenta de Instagram que deseas conectar.',
    );
  }

  async function startLogin() {
    if (
      !config?.ready ||
      !config.appId ||
      !config.apiVersion
    ) {
      setMessage(
        config?.message ||
          'Falta preparar Instagram en Meta.',
      );

      return;
    }

    setMessage('');
    setAccounts([]);
    setSelectedInstagramId('');
    setAccessToken('');

    const redirectUri =
      `${window.location.origin}/api/integrations/instagram/callback`;

    const state =
      crypto.randomUUID()
        .replace(/-/g, '');

    window.sessionStorage.setItem(
      'chatpro_instagram_oauth_state',
      state,
    );

    const oauthUrl =
      new URL(
        `https://www.facebook.com/${config.apiVersion}/dialog/oauth`,
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
      config.scopes?.join(',') || '',
    );

    oauthUrl.searchParams.set(
      'response_type',
      'code',
    );

    oauthUrl.searchParams.set(
      'state',
      state,
    );

    window.location.assign(
      oauthUrl.toString(),
    );
  }

  async function completeConnection() {
    if (
      !accessToken ||
      !selectedInstagramId
    ) {
      setMessage(
        'Selecciona primero la cuenta de Instagram.',
      );

      return;
    }

    setConnecting(true);
    setMessage('');

    try {
      const response =
        await fetch(
          '/api/integrations/instagram/complete',
          {
            method: 'POST',
            headers: {
              'content-type':
                'application/json',
            },
            body: JSON.stringify({
              accessToken,
              instagramId:
                selectedInstagramId,
            }),
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
            'No se pudo conectar Instagram.',
        );
      }

      setAccessToken('');

      setMessage(
        data.message ||
          'Instagram quedó conectado.',
      );

      window.setTimeout(
        () =>
          window.location.reload(),
        1000,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'No se pudo terminar la conexión de Instagram.',
      );
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div className={styles.testBox}>
      <strong>
        Conectar Instagram
      </strong>

      <p>
        Autoriza tu cuenta de Meta y
        selecciona la cuenta profesional
        de Instagram cuyos mensajes deseas
        administrar desde ChatPro.
      </p>

      {!accounts.length ? (
        <button
          type="button"
          className={
            styles.connectButton
          }
          onClick={() =>
            void startLogin()
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
              ? 'Conectando con Meta…'
              : 'Conectar Instagram con Meta'}
        </button>
      ) : (
        <>
          <label htmlFor="instagram-account">
            Cuenta de Instagram
          </label>

          <select
            id="instagram-account"
            value={
              selectedInstagramId
            }
            onChange={(event) =>
              setSelectedInstagramId(
                event.target.value,
              )
            }
            disabled={connecting}
          >
            <option value="">
              Selecciona una cuenta
            </option>

            {accounts.map(
              (account) => (
                <option
                  key={
                    account.instagramId
                  }
                  value={
                    account.instagramId
                  }
                >
                  {account.username
                    ? `@${account.username}`
                    : account.name ||
                      account.instagramId}
                </option>
              ),
            )}
          </select>

          <button
            type="button"
            className={
              styles.connectButton
            }
            onClick={() =>
              void completeConnection()
            }
            disabled={
              connecting ||
              !selectedInstagramId
            }
          >
            {connecting
              ? 'Guardando conexión…'
              : 'Confirmar Instagram'}
          </button>

          <button
            type="button"
            className={
              styles.testButton
            }
            onClick={() => {
              setAccounts([]);
              setAccessToken('');
              setSelectedInstagramId('');
              setMessage('');
            }}
            disabled={connecting}
          >
            Elegir otra cuenta
          </button>
        </>
      )}

      <small>
        {config?.ready
          ? 'Meta abrirá su ventana oficial de autorización. ChatPro no mostrará el token guardado.'
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
