'use client';

import { useEffect, useState } from 'react';
import { AppSidebar } from '../../../components/AppSidebar';

type MetaLeadConfig = {
  ok?: boolean;
  ready?: boolean;
  appId?: string;
  apiVersion?: string;
  scopes?: string[];
  missing?: string[];
  error?: string;
  message?: string;
  company?: {
    id?: string;
    slug?: string;
    name?: string;
  };
};

type FacebookPage = {
  id: string;
  name: string;
  tasks?: string[];
};

const shellStyle = {
  minHeight: '100vh',
  display: 'flex',
  background: '#f6f7f8',
} as const;

const contentStyle = {
  flex: 1,
  padding: '32px',
  maxWidth: '980px',
} as const;

const cardStyle = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: '16px',
  padding: '24px',
  display: 'grid',
  gap: '16px',
  boxShadow: '0 8px 24px rgba(0,0,0,.04)',
} as const;

const buttonStyle = {
  border: 0,
  borderRadius: '10px',
  padding: '12px 18px',
  fontWeight: 700,
  cursor: 'pointer',
  background: '#111827',
  color: '#fff',
  width: 'fit-content',
} as const;

const secondaryButtonStyle = {
  ...buttonStyle,
  background: '#fff',
  color: '#111827',
  border: '1px solid #d1d5db',
} as const;

export default function MetaLeadAdsConnectionPage() {
  const [config, setConfig] = useState<MetaLeadConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [message, setMessage] = useState('');
  const [pages, setPages] = useState<FacebookPage[]>([]);
  const [accessToken, setAccessToken] = useState('');
  const [selectedPageId, setSelectedPageId] = useState('');

  useEffect(() => {
    let active = true;

    async function loadConfig() {
      try {
        const response = await fetch('/api/integrations/meta-leads/config', {
          cache: 'no-store',
        });
        const data = (await response.json()) as MetaLeadConfig;

        if (active) {
          setConfig(data);
          if (!response.ok || !data.ok) {
            setMessage(data.error || 'No se pudo consultar Meta Lead Ads.');
          }
        }
      } catch {
        if (active) {
          setConfig({ ready: false });
          setMessage('No se pudo consultar la configuración de Meta Lead Ads.');
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadConfig();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!config?.ready || typeof window === 'undefined') return;

    const url = new URL(window.location.href);
    const code = url.searchParams.get('meta_leads_code')?.trim() || '';
    const returnedState =
      url.searchParams.get('meta_leads_state')?.trim() || '';
    const oauthError =
      url.searchParams.get('meta_leads_error')?.trim() || '';

    if (!code && !oauthError) return;

    url.searchParams.delete('meta_leads_code');
    url.searchParams.delete('meta_leads_state');
    url.searchParams.delete('meta_leads_error');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);

    if (oauthError) {
      setMessage(oauthError);
      return;
    }

    const expectedState =
      window.sessionStorage.getItem('chatpro_meta_leads_oauth_state') || '';
    window.sessionStorage.removeItem('chatpro_meta_leads_oauth_state');

    if (!returnedState || !expectedState || returnedState !== expectedState) {
      setMessage(
        'Meta regresó una autorización que no coincide con la solicitud iniciada en MW1.',
      );
      return;
    }

    const redirectUri =
      `${window.location.origin}/api/integrations/meta-leads/callback`;
    let cancelled = false;

    async function finishOAuth() {
      setConnecting(true);
      setMessage('Validando autorización con Meta…');

      try {
        const response = await fetch(
          '/api/integrations/meta-leads/exchange-code',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ code, redirectUri }),
          },
        );
        const data = (await response.json()) as {
          ok?: boolean;
          accessToken?: string;
          error?: string;
          message?: string;
        };

        if (!response.ok || !data.ok || !data.accessToken) {
          throw new Error(
            data.error || data.message || 'No se pudo completar la autorización de Meta.',
          );
        }

        if (cancelled) return;
        setAccessToken(data.accessToken);
        await discoverPages(data.accessToken);
      } catch (error) {
        if (!cancelled) {
          setMessage(
            error instanceof Error
              ? error.message
              : 'No se pudo completar la conexión con Meta.',
          );
        }
      } finally {
        if (!cancelled) setConnecting(false);
      }
    }

    void finishOAuth();

    return () => {
      cancelled = true;
    };
  }, [config?.ready]);

  async function discoverPages(token: string) {
    const response = await fetch('/api/integrations/meta-leads/discover', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessToken: token }),
    });
    const data = (await response.json()) as {
      ok?: boolean;
      pages?: FacebookPage[];
      error?: string;
      message?: string;
    };

    if (!response.ok || !data.ok || !data.pages) {
      throw new Error(
        data.error || data.message || 'No se pudieron consultar las Páginas de Facebook.',
      );
    }

    if (!data.pages.length) {
      throw new Error(
        'Meta no devolvió ninguna Página de Facebook administrada por esta cuenta.',
      );
    }

    setPages(data.pages);

    if (data.pages.length === 1) {
      setSelectedPageId(data.pages[0].id);
    }

    setMessage(
      data.pages.length === 1
        ? `Encontramos la Página ${data.pages[0].name}. Confirma para activar sus formularios.`
        : 'Selecciona la Página cuyos formularios instantáneos quieres enviar a MW1.',
    );
  }

  function startLogin() {
    if (!config?.ready || !config.appId || !config.apiVersion) {
      setMessage(
        config?.missing?.length
          ? `Falta configurar: ${config.missing.join(', ')}`
          : 'Meta Lead Ads todavía no está preparado.',
      );
      return;
    }

    setMessage('');
    setPages([]);
    setSelectedPageId('');
    setAccessToken('');

    const redirectUri =
      `${window.location.origin}/api/integrations/meta-leads/callback`;
    const state = crypto.randomUUID().replace(/-/g, '');

    window.sessionStorage.setItem('chatpro_meta_leads_oauth_state', state);

    const oauthUrl = new URL(
      `https://www.facebook.com/${config.apiVersion}/dialog/oauth`,
    );
    oauthUrl.searchParams.set('client_id', config.appId);
    oauthUrl.searchParams.set('redirect_uri', redirectUri);
    oauthUrl.searchParams.set('scope', config.scopes?.join(',') || '');
    oauthUrl.searchParams.set('response_type', 'code');
    oauthUrl.searchParams.set('state', state);

    window.location.assign(oauthUrl.toString());
  }

  async function completeConnection() {
    if (!accessToken || !selectedPageId) {
      setMessage('Selecciona primero la Página que deseas conectar.');
      return;
    }

    setConnecting(true);
    setMessage('Activando formularios instantáneos…');

    try {
      const response = await fetch('/api/integrations/meta-leads/complete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          accessToken,
          pageId: selectedPageId,
        }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
      };

      if (!response.ok || !data.ok) {
        throw new Error(
          data.error || data.message || 'No se pudo conectar Meta Lead Ads.',
        );
      }

      setAccessToken('');
      setPages([]);
      setSelectedPageId('');
      setMessage(
        data.message ||
          'Meta Lead Ads quedó conectado. Los nuevos formularios llegarán a MW1.',
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'No se pudo terminar la conexión de Meta Lead Ads.',
      );
    } finally {
      setConnecting(false);
    }
  }

  const companyName = config?.company?.name || 'Empresa';

  return (
    <main style={shellStyle}>
      <AppSidebar companyName={companyName} />

      <section style={contentStyle}>
        <div style={{ marginBottom: 24 }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 800, letterSpacing: 1 }}>
            CONFIGURACIÓN · INTEGRACIONES
          </p>
          <h1 style={{ margin: '8px 0' }}>Meta Lead Ads</h1>
          <p style={{ margin: 0, color: '#4b5563', maxWidth: 720 }}>
            Conecta la Página de Facebook que recibe tus formularios instantáneos.
            Los leads entrarán al CRM de MW1 sin necesidad de conectar Messenger.
          </p>
        </div>

        <div style={cardStyle}>
          <div>
            <strong style={{ fontSize: 18 }}>Formularios instantáneos → MW1</strong>
            <p style={{ color: '#4b5563', marginBottom: 0 }}>
              MW1 solicitará acceso a tus Páginas y al permiso de clientes
              potenciales. No habilita Messenger ni cambia tu WhatsApp.
            </p>
          </div>

          {!pages.length ? (
            <button
              type="button"
              style={{ ...buttonStyle, opacity: loading || connecting ? 0.6 : 1 }}
              onClick={startLogin}
              disabled={loading || connecting || !config?.ready}
            >
              {loading
                ? 'Revisando configuración…'
                : connecting
                  ? 'Conectando con Meta…'
                  : 'Conectar Meta Lead Ads'}
            </button>
          ) : (
            <>
              <label htmlFor="meta-leads-page" style={{ fontWeight: 700 }}>
                Página de Facebook
              </label>
              <select
                id="meta-leads-page"
                value={selectedPageId}
                onChange={(event) => setSelectedPageId(event.target.value)}
                disabled={connecting}
                style={{
                  maxWidth: 520,
                  padding: 12,
                  borderRadius: 10,
                  border: '1px solid #d1d5db',
                  background: '#fff',
                }}
              >
                <option value="">Selecciona una Página</option>
                {pages.map((page) => (
                  <option key={page.id} value={page.id}>
                    {page.name}
                  </option>
                ))}
              </select>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  style={{ ...buttonStyle, opacity: connecting ? 0.6 : 1 }}
                  onClick={() => void completeConnection()}
                  disabled={connecting || !selectedPageId}
                >
                  {connecting ? 'Activando…' : 'Activar formularios en MW1'}
                </button>
                <button
                  type="button"
                  style={secondaryButtonStyle}
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
              </div>
            </>
          )}

          <small style={{ color: '#6b7280' }}>
            Permisos solicitados: páginas administradas, metadatos de la Página,
            lectura de interacción y recuperación de leads. No se solicita
            pages_messaging para esta conexión.
          </small>

          {message ? (
            <div
              style={{
                padding: 12,
                borderRadius: 10,
                background: '#f3f4f6',
                lineHeight: 1.45,
              }}
            >
              {message}
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
