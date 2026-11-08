'use client';

import {
  useEffect,
  useState,
} from 'react';

import { getInstagramDisplayStatus } from '../../lib/instagram-display-status';
import styles from './page.module.css';

type InstagramConfig = {
  ok?: boolean;
  ready?: boolean;
  authorizationEnabled?: boolean;
  connectionEnabled?: boolean;
  appId?: string;
  configurationId?: string;
  apiVersion?: string;
  scopes?: string[];
  loginMode?: string;
  missing?: string[];
  webhookPreflight?: {
    endpointDeployed?: boolean;
    verificationTokenConfigured?: boolean;
    receiptEnabled?: boolean;
    appSubscriptionConfirmed?: boolean;
    inboxRepliesEnabled?: boolean;
    warning?: string;
  };
  diagnostics?: {
    pilotOnly?: boolean;
    multiCompanyActivationEnabled?: boolean;
    apiReady?: boolean;
    apiAuthorizationEnabled?: boolean;
    webStateSecretReady?: boolean;
    webAuthorizationEnabled?: boolean;
    callbackRegisteredInMeta?: string;
  };
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

  // Avoid reading browser-only location during the server render.
  const [isStaging, setIsStaging] = useState(false);
  const [showOnboardingDiagnostics, setShowOnboardingDiagnostics] = useState(false);
  const [checkingSubscription, setCheckingSubscription] = useState(false);
  const [subscriptionResult, setSubscriptionResult] = useState<{
    ok?: boolean;
    accountSubscribed?: boolean | null;
    messageSubscribed?: boolean | null;
    subscriptionRecordsFound?: number;
    status?: string;
    error?: string;
  } | null>(null);

  useEffect(() => {
    setIsStaging(
      window.location.hostname === 'mw1-web-staging-staging.up.railway.app',
    );
  }, []);

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

  const [
    testFeedback,
    setTestFeedback,
  ] =
    useState<{
      ok: boolean;
      title: string;
      detail: string;
      checkedAt: string;
    } | null>(null);

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
    // Read and remove OAuth parameters even when the pilot was disabled
    // while Meta was redirecting back. Never keep an authorization code in
    // the browser URL merely because the readiness check fails.
    if (loading || !config || typeof window === 'undefined') {
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

    const pilotDisabled =
      window.location.hostname === 'mw1-web-staging-staging.up.railway.app' &&
      config.authorizationEnabled !== true;

    if (!config.ready || pilotDisabled) {
      window.sessionStorage.removeItem('chatpro_instagram_oauth_state');
      setMessage('La autorización de Instagram no está habilitada. No se procesó ningún código ni se guardaron credenciales.');
      return;
    }

    if (oauthError) {
      window.sessionStorage.removeItem('chatpro_instagram_oauth_state');
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
        'Instagram regresó una autorización que no coincide con la solicitud iniciada en MW1.',
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
                  state: returnedState,
                }),
            },
          );

        const data =
          (await response.json()) as {
            ok?: boolean;
            pending?: boolean;
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
          data.pending
            ? (username
                ? `Instagram @${username} quedó pendiente de activación. Aún no recibe mensajes.`
                : 'Instagram quedó pendiente de activación. Aún no recibe mensajes.')
            : username
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
  }, [loading, config?.ready, config?.authorizationEnabled]);

  async function startLogin() {
    if (!config?.ready || !config.appId) {
      setMessage(config?.message || 'Falta preparar Instagram en Meta.');
      return;
    }
    const isStaging = window.location.hostname === 'mw1-web-staging-staging.up.railway.app';
    if (isStaging && config.authorizationEnabled !== true) {
      setMessage(config.message || 'Instagram sigue en preparación.');
      return;
    }
    if (config.loginMode !== 'unified_login' || !config.configurationId) {
      setMessage('Unified Login no está configurado. No se iniciará el flujo anterior.');
      return;
    }
    setMessage('');
    const redirectUri = window.location.origin + '/api/integrations/instagram/callback';
    let state = '';
    if (isStaging) {
      try {
        const response = await fetch('/api/integrations/instagram/begin', { method: 'POST', cache: 'no-store' });
        const payload = await response.json() as { ok?: boolean; state?: string; error?: string };
        if (!response.ok || !payload.ok || !payload.state) {
          throw new Error(payload.error || 'No se pudo iniciar la autorización segura.');
        }
        state = payload.state;
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'No se pudo preparar la conexión.');
        return;
      }
    } else {
      state = crypto.randomUUID().replace(/-/g, '');
    }
    window.sessionStorage.setItem('chatpro_instagram_oauth_state', state);
    const oauthUrl = new URL('https://www.facebook.com/dialog/oauth');
    oauthUrl.searchParams.set('client_id', config.appId);
    oauthUrl.searchParams.set('config_id', config.configurationId);
    oauthUrl.searchParams.set('redirect_uri', redirectUri);
    oauthUrl.searchParams.set('response_type', 'code');
    oauthUrl.searchParams.set('override_default_response_type', 'true');
    // Rely on the Meta configuration to manage sign-in and consent.
    // Do not force a login prompt unsupported by the configured dialog.
    oauthUrl.searchParams.set('state', state);
    window.location.assign(oauthUrl.toString());
  }

  async function testConnection() {
    setMessage('');
    setTestFeedback(null);
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
            'No se pudo verificar Instagram.',
        );
      }

      const verifiedUsername =
        data.instagram
          ?.username
          ?.trim();

      setTestFeedback({
        ok: true,
        title:
          'Conexión correcta',
        detail:
          verifiedUsername
            ? `Meta confirmó la autorización de @${verifiedUsername}. La recepción de mensajes sigue deshabilitada.`
            : 'Instagram confirmó la autorización del piloto. La recepción de mensajes sigue deshabilitada.',
        checkedAt:
          new Date()
            .toLocaleString(
              'es-CO',
              {
                dateStyle:
                  'short',
                timeStyle:
                  'short',
              },
            ),
      });
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message
          : 'No se pudo verificar Instagram.';

      setTestFeedback({
        ok: false,
        title:
          'La conexión requiere atención',
        detail,
        checkedAt:
          new Date()
            .toLocaleString(
              'es-CO',
              {
                dateStyle:
                  'short',
                timeStyle:
                  'short',
              },
            ),
      });
    } finally {
      setTesting(false);
    }
  }

  async function checkSubscription() {
    setCheckingSubscription(true);
    setSubscriptionResult(null);
    try {
      const response = await fetch('/api/integrations/instagram/webhook-subscription',
        { cache: 'no-store' });
      const data = await response.json() as {
        ok?: boolean; accountSubscribed?: boolean | null;
        messageSubscribed?: boolean | null;
        subscriptionRecordsFound?: number;
        status?: string; error?: string;
      };
      setSubscriptionResult(response.ok ? data : {
        ok: false,
        error: data.error || 'No se pudo consultar la suscripción en Meta.',
      });
    } catch {
      setSubscriptionResult({ok:false,error:'No se pudo consultar la suscripción en Meta.'});
    } finally {
      setCheckingSubscription(false);
    }
  }

  async function disconnectInstagram() {
    const confirmed =
      window.confirm(
        '¿Desconectar Instagram de MW1? La cuenta de Instagram no se elimina, pero MW1 dejará de procesar sus mensajes hasta que la vuelvas a autorizar.',
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

  const status = integration?.status || 'disconnected';

  const {
    connected,
    pending,
    requiresReconnect,
    authorizationBlocked,
  } = getInstagramDisplayStatus({
    status,
    isStaging,
    connectionEnabled: config?.connectionEnabled,
    authorizationEnabled: config?.authorizationEnabled,
  });

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
          : pending
            ? 'Instagram pendiente de activación'
            : requiresReconnect
              ? 'Instagram requiere reconexión'
              : authorizationBlocked
                ? 'Instagram aún no habilitado'
                : 'Conectar Instagram'}
      </strong>

      {pending ? (
        <>
          <p>
            {status === 'active' && isStaging
              ? 'MW1 no tiene la mensajería de Instagram habilitada en este entorno de prueba.'
              : username
                ? `Instagram @${username} está autorizado, pero la recepción de mensajes todavía está deshabilitada.`
                : 'La cuenta de Instagram está pendiente de activación. Todavía no recibe mensajes.'}
          </p>
          <small>
            La activación debe realizarse después de las verificaciones de seguridad.
          </small>
          {isStaging ? (
            <>
              <button type="button" className={styles.testButton}
                onClick={() => void checkSubscription()}
                disabled={checkingSubscription || testing || connecting}>
                {checkingSubscription ? 'Consultando suscripción…' : 'Comprobar suscripción de mensajes en Meta'}
              </button>
              {subscriptionResult ? (
                <div role="status" style={{padding:12,marginTop:8,borderRadius:8,
                  border:'1px solid #d7deeb',background:'#f6f8fc'}}>
                  <strong>Suscripción de la cuenta piloto</strong>
                  {subscriptionResult.ok ? (
                    <p>
                      Cuenta suscrita: {subscriptionResult.accountSubscribed === true ? 'Sí' :
                        subscriptionResult.accountSubscribed === false ? 'No' : 'No se pudo determinar'}.{' '}
                      Evento messages: {subscriptionResult.messageSubscribed === true ? 'Confirmado' :
                        subscriptionResult.messageSubscribed === false ? 'No confirmado' : 'Sin determinar'}.
                      {subscriptionResult.status === 'unrecognized_app_id' ? (
                        <span> Meta devolvió suscripciones, pero MW1 todavía no identifica la app asociada. No se modificó nada.</span>
                      ) : null}
                      {typeof subscriptionResult.subscriptionRecordsFound === 'number' ? (
                        <span> Registros de suscripción encontrados: {subscriptionResult.subscriptionRecordsFound}.</span>
                      ) : null}
                    </p>
                  ) : (
                    <p>{subscriptionResult.error || 'Meta no confirmó la suscripción.'}</p>
                  )}
                  <small>Esta consulta no activa eventos ni cambia las suscripciones.</small>
                </div>
              ) : null}
              <button type="button" className={styles.testButton}
                onClick={() => void testConnection()}
                disabled={testing || connecting}>
                {testing ? 'Comprobando autorización…' : 'Verificar autorización con Meta'}
              </button>
              {testFeedback ? (
                <div role={testFeedback.ok ? 'status' : 'alert'} style={{
                  marginTop: 10, padding: 12, borderRadius: 9,
                  background: testFeedback.ok ? '#eff8f0' : '#fff2f2',
                  border: testFeedback.ok ? '1px solid #b7dfbf' : '1px solid #efc0c0',
                }}>
                  <strong>{testFeedback.title}</strong>
                  <p>{testFeedback.detail}</p>
                  <small>Esta verificación no activa los mensajes ni modifica la autorización.</small>
                </div>
              ) : null}
            </>
          ) : null}
        </>
      ) : hasConnection ? (
        <>
          <p>
            {connected
              ? 'MW1 verificó la cuenta y las credenciales guardadas con Meta.'
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

          {testFeedback ? (
            <div
              role={
                testFeedback.ok
                  ? 'status'
                  : 'alert'
              }
              style={{
                display:
                  'grid',
                gap: 5,
                marginTop:
                  10,
                padding:
                  '12px 14px',
                borderRadius:
                  10,
                border:
                  testFeedback.ok
                    ? '1px solid #b7dfbf'
                    : '1px solid #efc0c0',
                background:
                  testFeedback.ok
                    ? '#eef9f0'
                    : '#fff2f2',
                color:
                  testFeedback.ok
                    ? '#1d642e'
                    : '#8f2929',
              }}
            >
              <strong>
                {testFeedback.ok
                  ? '✓ '
                  : '⚠ '}
                {testFeedback.title}
              </strong>

              <span>
                {testFeedback.detail}
              </span>

              <small
                style={{
                  color:
                    'inherit',
                  opacity:
                    0.75,
                }}
              >
                Verificado:{' '}
                {testFeedback.checkedAt}
              </small>

              {!testFeedback.ok ? (
                <small>
                  Usa “Reconectar Instagram”
                  para renovar la autorización.
                </small>
              ) : null}
            </div>
          ) : null}

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
              !config?.ready ||
              authorizationBlocked
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
            Autoriza una cuenta profesional de Instagram (Empresa o Creador).
            Meta puede mostrar una pantalla de acceso empresarial con las
            opciones «Continuar con Facebook» o «Continuar con Instagram».
            Para la prueba de MW1, utiliza la cuenta profesional independiente
            @chatpro_mw1 y completa la pantalla de permisos de Meta.
          </p>
          {isStaging ? (
            <small>
              Entrar a la página principal de Facebook no es una autorización.
              Si Meta no muestra los permisos ni te devuelve a MW1,
              cierra esa ventana y revisa el diagnóstico; no selecciones
              cuentas operativas.
            </small>
          ) : null}

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
              !config?.ready ||
              authorizationBlocked
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
        {authorizationBlocked
          ? config?.message || 'El piloto de Instagram está en preparación. No se permiten conexiones todavía.'
          : config?.ready
            ? 'La autorización se realiza directamente con Instagram. Las credenciales se procesan y guardan cifradas en el servidor.'
          : config?.message ||
            (
              config?.missing
                ?.length
                ? `Falta configurar: ${config.missing.join(', ')}`
                : 'Instagram todavía no está configurado.'
            )}
      </small>

      {isStaging && config?.webhookPreflight ? (
        <div style={{
          marginTop: 12, padding: 12, borderRadius: 10,
          border: '1px solid #d7deeb', background: '#f6f8fc',
          display: 'grid', gap: 6,
        }}>
          <strong>Preparación de mensajes de Instagram (piloto)</strong>
          <small>Receptor de mensajes: {config.webhookPreflight.endpointDeployed ? 'Preparado' : 'No confirmado'}</small>
          <small>Verificación de Meta: {config.webhookPreflight.verificationTokenConfigured ? 'Token preparado' : 'Sin configurar'}</small>
          <small>Suscripción en Meta: {config.webhookPreflight.appSubscriptionConfirmed ? 'Confirmada' : 'Pendiente de comprobar'}</small>
          <small>Recepción de mensajes: {config.webhookPreflight.receiptEnabled ? 'Habilitada para el piloto' : 'Deshabilitada'}</small>
          <small>Responder desde MW1: {config.webhookPreflight.inboxRepliesEnabled ? 'Habilitado' : 'Pendiente'}</small>
          <small>{config.webhookPreflight.warning}</small>
        </div>
      ) : null}

      {isStaging && !hasConnection ? (
        <div style={{marginTop: 12}}>
          <button type="button" className={styles.testButton}
            onClick={() => setShowOnboardingDiagnostics(value => !value)}>
            {showOnboardingDiagnostics ? 'Ocultar diagnóstico' : 'Diagnosticar conexión de Instagram'}
          </button>
          {showOnboardingDiagnostics ? (
            <div role="status" style={{marginTop: 10, padding: 12, borderRadius: 10,
              border: '1px solid #d7deeb', background: '#f6f8fc', display: 'grid', gap: 6}}>
              <strong>Diagnóstico seguro del piloto</strong>
              <small>Alcance actual: {config?.diagnostics?.pilotOnly === true ? 'Solo empresa piloto' : 'No confirmado'}.</small>
              <small>Activación para empresas nuevas: {config?.diagnostics?.multiCompanyActivationEnabled === true ? 'Habilitada' : 'Aún no habilitada'}.</small>
              <small>API preparada: {config?.diagnostics?.apiReady === true ? 'Sí' : 'No confirmado'}</small>
              <small>Autorización API: {config?.diagnostics?.apiAuthorizationEnabled === true ? 'Habilitada' : 'Bloqueada o no confirmada'}</small>
              <small>Firma OAuth web: {config?.diagnostics?.webStateSecretReady === true ? 'Preparada' : 'Falta verificar'}</small>
              <small>Autorización web: {config?.diagnostics?.webAuthorizationEnabled === true ? 'Habilitada' : 'No habilitada'}</small>
              {config?.missing?.length ? (
                <small>Requisitos pendientes: {config.missing.join(', ')}</small>
              ) : null}
              <small>Meta (callback y permisos): comprobación independiente; este diagnóstico no abre OAuth ni genera tokens.</small>
              <small>La habilitación del piloto requiere el procedimiento de seguridad autorizado.</small>
            </div>
          ) : null}
        </div>
      ) : null}

      {message ? (
        <p>{message}</p>
      ) : null}
    </div>
  );
}
