'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppSidebar } from '../../components/AppSidebar';

type Entitlements = {
  planKey: string;
  aiEnabled: boolean;
  whatsappEnabled: boolean;
  instagramEnabled: boolean;
  messengerEnabled: boolean;
  automationsEnabled: boolean;
  statisticsEnabled: boolean;
  maxUsers: number | null;
  maxWhatsappLines: number | null;
};

type Company = {
  id: string;
  slug: string;
  name: string;
  status: string;
  activeUsers: number;
  entitlements: Entitlements;
};

type CompaniesResponse = {
  ok?: boolean;
  error?: string;
  companies?: Company[];
};

type FormState = {
  name: string;
  slug: string;
  planKey: string;
  aiEnabled: boolean;
  whatsappEnabled: boolean;
  instagramEnabled: boolean;
  messengerEnabled: boolean;
  automationsEnabled: boolean;
  statisticsEnabled: boolean;
  maxUsers: string;
  maxWhatsappLines: string;
  ownerFullName: string;
  ownerIdentifier: string;
  ownerPassword: string;
};

const initialForm: FormState = {
  name: '',
  slug: '',
  planKey: 'custom',
  aiEnabled: false,
  whatsappEnabled: true,
  instagramEnabled: false,
  messengerEnabled: false,
  automationsEnabled: true,
  statisticsEnabled: true,
  maxUsers: '3',
  maxWhatsappLines: '1',
  ownerFullName: '',
  ownerIdentifier: '',
  ownerPassword: '',
};

const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 18,
  padding: 24,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid #d9dde5',
  borderRadius: 10,
  padding: '11px 12px',
  fontSize: 14,
};

export default function PlatformCompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [form, setForm] = useState<FormState>(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  async function load() {
    setLoading(true);
    setError('');

    try {
      const meResponse = await fetch('/api/platform-admin/me', { cache: 'no-store' });
      const me = (await meResponse.json()) as {
        ok?: boolean;
        platformAdmin?: boolean;
        error?: string;
      };

      if (!meResponse.ok || !me.ok || me.platformAdmin !== true) {
        setAuthorized(false);
        setError(me.error || 'No tienes permiso de Super Admin de MW1.');
        return;
      }

      setAuthorized(true);
      const response = await fetch('/api/platform-admin/companies', { cache: 'no-store' });
      const data = (await response.json()) as CompaniesResponse;

      if (!response.ok || !data.ok) {
        setError(data.error || 'No se pudieron cargar las empresas.');
        return;
      }

      setCompanies(data.companies || []);
    } catch {
      setError('No se pudo cargar la administración de empresas.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function setValue<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function generateSlug(name: string) {
    return name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const response = await fetch('/api/platform-admin/companies', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...form,
          maxUsers: Number(form.maxUsers),
          maxWhatsappLines: Number(form.maxWhatsappLines),
        }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        company?: { name?: string };
      };

      if (!response.ok || !data.ok) {
        setError(data.error || 'No se pudo crear la empresa.');
        return;
      }

      setSuccess(`${data.company?.name || 'La empresa'} quedó creada y aislada.`);
      setForm(initialForm);
      await load();
    } catch {
      setError('No se pudo crear la empresa.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f5f6f8', color: '#171a21' }}>
      <AppSidebar />
      <main style={{ marginLeft: 160, padding: '38px 42px 80px', maxWidth: 1500 }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.4, color: '#9a7627' }}>
            SUPER ADMIN MW1
          </div>
          <h1 style={{ fontSize: 36, margin: '4px 0 6px' }}>Empresas</h1>
          <p style={{ margin: 0, color: '#667085' }}>
            Crea empresas independientes, define accesos y controla sus límites.
          </p>
        </div>

        {error ? (
          <div style={{ ...cardStyle, borderColor: '#f3c5c5', background: '#fff7f7', marginBottom: 18 }}>
            {error}
          </div>
        ) : null}
        {success ? (
          <div style={{ ...cardStyle, borderColor: '#b9e3c5', background: '#f4fff7', marginBottom: 18 }}>
            {success}
          </div>
        ) : null}

        {authorized === false ? null : (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(460px, 0.9fr) minmax(520px, 1.1fr)', gap: 22 }}>
            <form onSubmit={submit} style={cardStyle}>
              <h2 style={{ marginTop: 0 }}>+ Nueva empresa</h2>
              <p style={{ color: '#667085', marginTop: -6 }}>
                La empresa inicia sin chats, clientes, productos ni credenciales de otra empresa.
              </p>

              <div style={{ display: 'grid', gap: 14 }}>
                <label>
                  <strong>Nombre de la empresa</strong>
                  <input
                    style={{ ...inputStyle, marginTop: 6 }}
                    value={form.name}
                    onChange={(event) => {
                      const name = event.target.value;
                      setForm((current) => ({
                        ...current,
                        name,
                        slug: current.slug ? current.slug : generateSlug(name),
                      }));
                    }}
                    placeholder="Emprende Cosmoshogo"
                    required
                  />
                </label>

                <label>
                  <strong>Identificador</strong>
                  <input
                    style={{ ...inputStyle, marginTop: 6 }}
                    value={form.slug}
                    onChange={(event) => setValue('slug', generateSlug(event.target.value))}
                    placeholder="emprende-cosmoshogo"
                    required
                  />
                </label>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <label>
                    <strong>Plan</strong>
                    <input style={{ ...inputStyle, marginTop: 6 }} value={form.planKey} onChange={(e) => setValue('planKey', e.target.value)} />
                  </label>
                  <label>
                    <strong>Usuarios</strong>
                    <input type="number" min="1" style={{ ...inputStyle, marginTop: 6 }} value={form.maxUsers} onChange={(e) => setValue('maxUsers', e.target.value)} />
                  </label>
                  <label>
                    <strong>Líneas WA</strong>
                    <input type="number" min="1" style={{ ...inputStyle, marginTop: 6 }} value={form.maxWhatsappLines} onChange={(e) => setValue('maxWhatsappLines', e.target.value)} />
                  </label>
                </div>

                <div style={{ borderTop: '1px solid #eceef2', paddingTop: 14 }}>
                  <strong>Módulos habilitados</strong>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
                    {([
                      ['aiEnabled', 'IA'],
                      ['whatsappEnabled', 'WhatsApp'],
                      ['instagramEnabled', 'Instagram'],
                      ['messengerEnabled', 'Messenger'],
                      ['automationsEnabled', 'Automatizaciones'],
                      ['statisticsEnabled', 'Estadísticas'],
                    ] as Array<[keyof FormState, string]>).map(([key, label]) => (
                      <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input
                          type="checkbox"
                          checked={Boolean(form[key])}
                          onChange={(event) => setValue(key, event.target.checked as never)}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>

                <div style={{ borderTop: '1px solid #eceef2', paddingTop: 14 }}>
                  <strong>Propietario inicial</strong>
                  <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
                    <input style={inputStyle} value={form.ownerFullName} onChange={(e) => setValue('ownerFullName', e.target.value)} placeholder="Nombre completo" required />
                    <input style={inputStyle} value={form.ownerIdentifier} onChange={(e) => setValue('ownerIdentifier', e.target.value)} placeholder="Código de acceso" required />
                    <input type="password" minLength={8} style={inputStyle} value={form.ownerPassword} onChange={(e) => setValue('ownerPassword', e.target.value)} placeholder="Contraseña inicial (mínimo 8 caracteres)" required />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={saving}
                  style={{ border: 0, borderRadius: 10, background: '#171a21', color: '#fff', padding: '12px 16px', fontWeight: 800, cursor: 'pointer' }}
                >
                  {saving ? 'Creando empresa…' : 'Crear empresa'}
                </button>
              </div>
            </form>

            <section style={cardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h2 style={{ margin: 0 }}>Empresas en MW1</h2>
                  <p style={{ color: '#667085', margin: '5px 0 0' }}>{companies.length} empresas registradas</p>
                </div>
                <button type="button" onClick={() => void load()} style={{ ...inputStyle, width: 'auto', cursor: 'pointer', background: '#fff' }}>
                  Actualizar
                </button>
              </div>

              {loading ? <p>Cargando…</p> : null}
              {!loading && companies.length === 0 ? <p>No hay empresas todavía.</p> : null}

              <div style={{ display: 'grid', gap: 12, marginTop: 18 }}>
                {companies.map((company) => (
                  <article key={company.id} style={{ border: '1px solid #e7e9ee', borderRadius: 14, padding: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <div>
                        <strong style={{ fontSize: 17 }}>{company.name}</strong>
                        <div style={{ color: '#667085', fontSize: 13 }}>{company.slug}</div>
                      </div>
                      <span style={{ alignSelf: 'start', background: company.status === 'active' ? '#eaf8ee' : '#f2f3f5', padding: '5px 9px', borderRadius: 999, fontSize: 12, fontWeight: 700 }}>
                        {company.status}
                      </span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 14, fontSize: 13 }}>
                      <span><strong>Plan:</strong> {company.entitlements.planKey}</span>
                      <span><strong>Usuarios:</strong> {company.activeUsers}/{company.entitlements.maxUsers ?? '∞'}</span>
                      <span><strong>IA:</strong> {company.entitlements.aiEnabled ? 'Sí' : 'No'}</span>
                      <span><strong>WhatsApp:</strong> {company.entitlements.whatsappEnabled ? 'Sí' : 'No'}</span>
                      <span><strong>Automat.:</strong> {company.entitlements.automationsEnabled ? 'Sí' : 'No'}</span>
                      <span><strong>Estadísticas:</strong> {company.entitlements.statisticsEnabled ? 'Sí' : 'No'}</span>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
