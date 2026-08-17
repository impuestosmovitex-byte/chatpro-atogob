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
  error?: string;
  message?: string;
};

type FacebookLoginResponse = {
  authResponse?: {
    accessToken?: string;
  };
  status?: string;
};

type FacebookSdk = {
  init(options: {
    appId: string;
    cookie: boolean;
    xfbml: boolean;
    version: string;
  }): void;

  login(
    callback: (
      response: FacebookLoginResponse,
    ) => void,
    options: Record<string, unknown>,
  ): void;
};

type FacebookWindow = Window & {
  FB?: FacebookSdk;
  fbAsyncInit?: () => void;
};

type FacebookPage = {
  id: string;
  name: string;
  tasks?: string[];
};

function loadFacebookSdk(
  appId: string,
  apiVersion: string,
): Promise<FacebookSdk> {
  return new Promise(
    (resolve, reject) => {
      const target =
        window as FacebookWindow;

      const finish = () => {
        if (!target.FB) {
          reject(
            new Error(
              'Meta no cargó su componente de conexión.',
            ),
          );

          return;
        }

        target.FB.init({
          appId,
          cookie: true,
          xfbml: false,
          version: apiVersion,
        });

        resolve(target.FB);
      };

      if (target.FB) {
        finish();
        return;
      }

      target.fbAsyncInit = finish;

      const existing =
        document.getElementById(
          'facebook-jssdk',
        );

      if (existing) {
        const startedAt = Date.now();

        const wait = window.setInterval(
          () => {
            if (target.FB) {
              window.clearInterval(wait);
              finish();
              return;
            }

            if (
              Date.now() - startedAt >
              15_000
            ) {
              window.clearInterval(wait);

              reject(
                new Error(
                  'Meta no terminó de cargar su componente de conexión.',
                ),
              );
            }
          },
          100,
        );

        return;
      }

      const script =
        document.createElement('script');

      script.id = 'facebook-jssdk';
      script.async = true;
      script.defer = true;
      script.crossOrigin = 'anonymous';
      script.src =
        'https://connect.facebook.net/es_LA/sdk.js';

      script.onerror = () =>
        reject(
          new Error(
            'No se pudo cargar la conexión de Meta.',
          ),
        );

      document.body.appendChild(script);
    },
  );
}

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
    setConnecting(true);

    try {
      const sdk =
        await loadFacebookSdk(
          config.appId,
          config.apiVersion,
        );

      const token =
        await new Promise<string>(
          (resolve, reject) => {
            sdk.login(
              (response) => {
                const nextToken =
                  response.authResponse
                    ?.accessToken?.trim() ||
                  '';

                if (!nextToken) {
                  reject(
                    new Error(
                      'La autorización de Meta fue cancelada o no se completó.',
                    ),
                  );

                  return;
                }

                resolve(nextToken);
              },
              {
                scope:
                  config.scopes?.join(
                    ',',
                  ) || '',
                return_scopes: true,
              },
            );
          },
        );

      setAccessToken(token);

      await discoverPages(token);
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
        desde ChatPro.
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
          ? 'Meta abrirá su ventana oficial de autorización. ChatPro no mostrará el token guardado.'
          : config?.message ||
            (config?.missing?.length
              ? `Falta configurar: ${config.missing.join(', ')}`
              : 'Messenger todavía no está configurado.')}
      </small>

      {message ? (
        <p>{message}</p>
      ) : null}
    </div>
  );
}
