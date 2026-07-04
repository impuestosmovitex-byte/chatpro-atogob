'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppSidebar } from '../../components/AppSidebar';
import styles from './page.module.css';

const COMPANY = process.env.NEXT_PUBLIC_CHATPRO_COMPANY || 'atogob';

type Identity = {
  businessName: string;
  legalName: string;
  taxId: string;
  logoUrl: string;
  phone: string;
  email: string;
  website: string;
  country: string;
  city: string;
  currency: string;
  timezone: string;
};

type ResponseData = {
  ok?: boolean;
  error?: string;
  company?: { name?: string };
  identity?: Identity;
};

const EMPTY: Identity = {
  businessName: '',
  legalName: '',
  taxId: '',
  logoUrl: '',
  phone: '',
  email: '',
  website: '',
  country: '',
  city: '',
  currency: 'COP',
  timezone: 'America/Bogota',
};

export default function EmpresaIdentidadPage() {
  const [identity, setIdentity] = useState<Identity>(EMPTY);
  const [companyName, setCompanyName] = useState('Empresa');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch(
          `/api/company-profile?company=${encodeURIComponent(COMPANY)}`,
          { cache: 'no-store' },
        );
        const data = (await response.json()) as ResponseData;

        if (!response.ok || !data.ok || !data.identity) {
          throw new Error(data.error || 'No se pudo cargar la identidad.');
        }

        setIdentity(data.identity);
        setCompanyName(data.company?.name || data.identity.businessName || 'Empresa');
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : 'No se pudo cargar la identidad.',
        );
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, []);

  function update<K extends keyof Identity>(key: K, value: Identity[K]) {
    setIdentity((current) => ({ ...current, [key]: value }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage('');

    try {
      const response = await fetch(
        `/api/company-profile?company=${encodeURIComponent(COMPANY)}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(identity),
        },
      );
      const data = (await response.json()) as ResponseData;

      if (!response.ok || !data.ok || !data.identity) {
        throw new Error(data.error || 'No se pudo guardar la identidad.');
      }

      setIdentity(data.identity);
      setCompanyName(data.company?.name || data.identity.businessName || 'Empresa');
      setMessage('Identidad de empresa guardada correctamente.');
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'No se pudo guardar la identidad.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className={styles.shell}>
      <AppSidebar companyName={companyName} />

      <section className={styles.workspace}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>CONFIGURACIÓN</p>
            <h1>Empresa e identidad · {companyName}</h1>
            <p>
              Datos generales de esta empresa. Estos datos pertenecen solo a
              este espacio de trabajo.
            </p>
          </div>
          <button
            type="button"
            className={styles.back}
            onClick={() => window.location.assign('/configuracion')}
          >
            ← Volver a configuración
          </button>
        </header>

        <form className={styles.card} onSubmit={save}>
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2>Identidad comercial</h2>
              <p>Información que identifica a la empresa dentro de Chat Pro.</p>
            </div>

            <div className={styles.grid}>
              <label>
                <span>Nombre comercial *</span>
                <input
                  value={identity.businessName}
                  onChange={(event) => update('businessName', event.target.value)}
                  disabled={loading}
                  placeholder="Ejemplo: Mi Empresa"
                  required
                />
              </label>

              <label>
                <span>Razón social</span>
                <input
                  value={identity.legalName}
                  onChange={(event) => update('legalName', event.target.value)}
                  disabled={loading}
                  placeholder="Ejemplo: Mi Empresa S.A.S."
                />
              </label>

              <label>
                <span>NIT o identificación tributaria</span>
                <input
                  value={identity.taxId}
                  onChange={(event) => update('taxId', event.target.value)}
                  disabled={loading}
                  placeholder="Ejemplo: 900123456-7"
                />
              </label>

              <label>
                <span>URL de logo</span>
                <input
                  value={identity.logoUrl}
                  onChange={(event) => update('logoUrl', event.target.value)}
                  disabled={loading}
                  placeholder="https://..."
                />
              </label>
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2>Contacto y ubicación</h2>
              <p>Datos disponibles para la configuración y futuros canales.</p>
            </div>

            <div className={styles.grid}>
              <label>
                <span>Teléfono</span>
                <input
                  value={identity.phone}
                  onChange={(event) => update('phone', event.target.value)}
                  disabled={loading}
                  placeholder="+57 300 000 0000"
                />
              </label>

              <label>
                <span>Correo de contacto</span>
                <input
                  type="email"
                  value={identity.email}
                  onChange={(event) => update('email', event.target.value)}
                  disabled={loading}
                  placeholder="contacto@empresa.com"
                />
              </label>

              <label>
                <span>Sitio web</span>
                <input
                  value={identity.website}
                  onChange={(event) => update('website', event.target.value)}
                  disabled={loading}
                  placeholder="https://empresa.com"
                />
              </label>

              <label>
                <span>País</span>
                <input
                  value={identity.country}
                  onChange={(event) => update('country', event.target.value)}
                  disabled={loading}
                  placeholder="Ejemplo: Colombia"
                />
              </label>

              <label>
                <span>Ciudad</span>
                <input
                  value={identity.city}
                  onChange={(event) => update('city', event.target.value)}
                  disabled={loading}
                  placeholder="Ejemplo: Bogotá"
                />
              </label>
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2>Operación</h2>
              <p>Valores predeterminados para reportes, canales y atención.</p>
            </div>

            <div className={styles.grid}>
              <label>
                <span>Moneda</span>
                <select
                  value={identity.currency}
                  onChange={(event) => update('currency', event.target.value)}
                  disabled={loading}
                >
                  <option value="COP">COP · Peso colombiano</option>
                  <option value="USD">USD · Dólar estadounidense</option>
                  <option value="MXN">MXN · Peso mexicano</option>
                  <option value="EUR">EUR · Euro</option>
                </select>
              </label>

              <label>
                <span>Zona horaria</span>
                <select
                  value={identity.timezone}
                  onChange={(event) => update('timezone', event.target.value)}
                  disabled={loading}
                >
                  <option value="America/Bogota">América/Bogotá</option>
                  <option value="America/Mexico_City">América/Ciudad de México</option>
                  <option value="America/Lima">América/Lima</option>
                  <option value="America/Santiago">América/Santiago</option>
                  <option value="America/Argentina/Buenos_Aires">América/Buenos Aires</option>
                  <option value="America/New_York">América/Nueva York</option>
                  <option value="Europe/Madrid">Europa/Madrid</option>
                </select>
              </label>
            </div>
          </section>

          {message ? <p className={styles.message}>{message}</p> : null}

          <button className={styles.save} type="submit" disabled={loading || saving}>
            {saving ? 'Guardando…' : 'Guardar empresa e identidad'}
          </button>
        </form>
      </section>
    </main>
  );
}
