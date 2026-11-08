'use client';

import {
  useEffect,
  useState,
} from 'react';

import styles from './page.module.css';

type MessengerConfig = {
  ok?: boolean;
  ready?: boolean;
  appId?: string;
  apiVersion?: string;
  scopes?: string[];
  missing?: string[];
  checks?: {
    isolatedPilot?: boolean;
    metaAppConfigured?: boolean;
    metaAppSecretConfigured?: boolean;
    encryptedCredentialStorageConfigured?: boolean;
    serverSideOAuthStateVerified?: boolean;
    pageOwnershipVerified?: boolean;
    approvedPageMessagingAccessVerified?: boolean;
    webhookSubscriptionEnabled?: boolean;
  };
  error?: string;
  message?: string;
};

type FacebookPage = {
  id: string;
  name: string;
  tasks?: string[];
};

export function MessengerConnectButton() {
  const [config, setConfig] =
    useState<MessengerConfig | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [
    connecting,
    setConnecting,
  ] = useState(false);

  const [message, setMessage] =
    useState('');

  const [pages, setPages] =
    useState<FacebookPage[]>([]);

  const [
    accessToken,
    setAccessToken,
  ] = useState('');

  const [
    selectedPageId,
    setSelectedPageId,
  ] = useState('');

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const response = await fetch(
          '/api/integrations/messenger/config',
          {
            cache: 'no-store',
          },
        );

        const data =
          (await response.json()) as MessengerConfig;

        if (active) {
          setConfig(data);
        }
      } catch {
        if (active) {
          setConfig({
            ready: false,
            message:
              'No se pudo consultar la configuración de Messenger.',
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
    // Remove OAuth codes from the browser address even if Messenger was
    // disabled while Meta redirected. Never retain a staging callback code.
    if (!config || typeof window === 'undefined') {
      return;
    }

    const url = new URL(window.location.href);

    const code =
      url.searchParams.get('messenger_code')?.trim() || '';
    const returnedState =
      url.searchParams.get('messenger_state')?.trim() || '';
    const oauthError =
      url.searchParams.get('messenger_error')?.trim() || '';

    if (!code && !oauthError && !returnedState) {
      return;
    }

    url.searchParams.delete('messenger_code');
    url.searchParams.delete('messenger_state');
    url.searchParams.delete('messenger_error');

    window.history.replaceState(
      {},
      '',
      `${url.pathname}${url.search}${url.hash}`,
    );

    if (!config.ready) {
      window.sessionStorage.removeItem('chatpro_messenger_oauth_state');
      setMessage(config.message || 'Messenger todavía no está habilitado.');
      return;
    }

    if (oauthError) {
      window.sessionStorage.removeItem('chatpro_messenger_oauth_state');
      setMessage(oauthError);
      return;
    }

    const expectedState =
      window.sessionStorage.getItem(
        'chatpro_messenger_oauth_state',
      ) || '';

    window.sessionStorage.removeItem(
      'chatpro_messenger_oauth_state',
    );

    if (
      !returnedState ||
      !expectedState ||
      returnedState !== expectedState
    ) {
      setMessage(
        'Meta regresó una autorización que no coincide con la solicitud iniciada en MW1.',
      );
      return;
    }

    const redirectUri =
      `${window.location.origin}/api/integrations/messenger/callback`;

    let cancelled = false;

    async function finishOAuth() {
      setConnecting(true);
      setMessage(
        'Validando autorización con Meta…',
      );

      try {
        const response = await fetch(
          '/api/integrations/messenger/exchange-code',
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

        const data = (await response.json()) as {
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

        if (cancelled) return;

        setAccessToken(
          data.accessToken,
        );

        await discoverPages(
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

  async function discoverPages(
    token: string,
  ) {
    const response = await fetch(
      '/api/integrations/messenger/discover',
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

    const data = (await response.json()) as {
      ok?: boolean;
      pages?: FacebookPage[];
      message?: string;
      error?: string;
    };

    if (
      !response.ok ||
      !data.ok ||
      !data.pages
    ) {
      throw new Error(
        data.message ||
          data.error ||
          'No se pudieron consultar las Páginas de Facebook.',
      );
    }

    if (!data.pages.length) {
      throw new Error(
        'Meta no devolvió ninguna Página de Facebook administrada por esta cuenta.',
      );
    }

    setPages(data.pages);

    if (data.pages.length === 1) {
      setSelectedPageId(
        data.pages[0].id,
      );
    }

    setMessage(
      data.pages.length === 1
        ? `Encontramos la Página ${data.pages[0].name}. Confirma la conexión.`
        : 'Selecciona la Página de Facebook que deseas conectar.',
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
          'Falta preparar Messenger en Meta.',
      );

      return;
    }

    setMessage('');
    setPages([]);
    setSelectedPageId('');
    setAccessToken('');

    const redirectUri =
      `${window.location.origin}/api/integrations/messenger/callback`;

    const state =
      crypto.randomUUID().replace(/-/g, '');

    window.sessionStorage.setItem(
      'chatpro_messenger_oauth_state',
      state,
    );

    const oauthUrl = new URL(
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
      !selectedPageId
    ) {
      setMessage(
        'Selecciona primero la Página que deseas conectar.',
      );

      return;
    }

    setConnecting(true);
    setMessage('');

    try {
      const response = await fetch(
        '/api/integrations/messenger/complete',
        {
          method: 'POST',
          headers: {
            'content-type':
              'application/json',
          },
          body: JSON.stringify({
            accessToken,
            pageId: selectedPageId,
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
            'No se pudo conectar Messenger.',
        );
      }

      setAccessToken('');

      setMessage(
        data.message ||
          'Facebook Messenger quedó conectado.',
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
          : 'No se pudo terminar la conexión de Messenger.',
      );
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div className={styles.testBox}>
      <strong>
        Conectar Facebook Messenger
      </strong>

      <p>
        Autoriza tu cuenta de Meta y
        selecciona la Página de Facebook
        cuyos mensajes quieres administrar
        desde MW1.
      </p>

      {!pages.length ? (
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
              : 'Conectar Messenger con Meta'}
        </button>
      ) : (
        <>
          <label htmlFor="messenger-page">
            Página de Facebook
          </label>

          <select
            id="messenger-page"
            value={selectedPageId}
            onChange={(event) =>
              setSelectedPageId(
                event.target.value,
              )
            }
            disabled={connecting}
          >
            <option value="">
              Selecciona una Página
            </option>

            {pages.map((page) => (
              <option
                key={page.id}
                value={page.id}
              >
                {page.name}
              </option>
            ))}
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
              !selectedPageId
            }
          >
            {connecting
              ? 'Guardando conexión…'
              : 'Confirmar Messenger'}
          </button>

          <button
            type="button"
            className={
              styles.testButton
            }
            onClick={() => {
              setPages([]);
              setAccessToken('');
              setSelectedPageId('');
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
          ? 'Meta abrirá su ventana oficial de autorización. MW1 no mostrará el token guardado.'
          : config?.message ||
            (config?.missing?.length
              ? `Falta configurar: ${config.missing.join(', ')}`
              : 'Messenger todavía no está configurado.')}
      </small>

      {config?.checks ? (
        <div style={{marginTop:12,padding:12,background:'#f8fafc',border:'1px solid #dce5ed',borderRadius:10}}>
          <strong>Preparación de Messenger (solo piloto)</strong>
          <ul style={{marginTop:9,paddingLeft:20,lineHeight:1.8}}>
            <li>Empresa de prueba aislada: {config.checks.isolatedPilot ? 'Confirmada' : 'Pendiente'}</li>
            <li>Aplicación Meta: {config.checks.metaAppConfigured ? 'Configurada' : 'Pendiente'}</li>
            <li>Credenciales privadas: {config.checks.metaAppSecretConfigured ? 'Configuradas' : 'Pendientes'}</li>
            <li>Cifrado de credenciales: {config.checks.encryptedCredentialStorageConfigured ? 'Configurado' : 'Pendiente'}</li>
            <li>Autorización segura OAuth: {config.checks.serverSideOAuthStateVerified ? 'Verificada' : 'Pendiente'}</li>
            <li>Titularidad de la página: {config.checks.pageOwnershipVerified ? 'Verificada' : 'Pendiente'}</li>
            <li>Permiso de mensajes de Páginas: {config.checks.approvedPageMessagingAccessVerified ? 'Verificado' : 'Pendiente'}</li>
            <li>Recepción de mensajes: {config.checks.webhookSubscriptionEnabled ? 'Habilitada' : 'Deshabilitada'}</li>
          </ul>
          <small>Esta comprobación no inicia sesión en Meta, no conecta páginas y no almacena tokens.</small>
        </div>
      ) : null}

      {message ? (
        <p>{message}</p>
      ) : null}
    </div>
  );
}
