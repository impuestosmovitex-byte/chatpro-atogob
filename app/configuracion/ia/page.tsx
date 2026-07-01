'use client';

import { AppSidebar } from '../../components/AppSidebar';

import { FormEvent, useEffect, useState } from 'react';
import styles from './page.module.css';

const COMPANY = process.env.NEXT_PUBLIC_CHATPRO_COMPANY || 'atogob';

type Configuration = {
  assistantName: string;
  tone: string;
  aiInstructions: string;
};

type ResponseData = {
  ok?: boolean;
  error?: string;
  company?: { name?: string };
  configuration?: Configuration;
};

const EMPTY: Configuration = {
  assistantName: '',
  tone: 'Cercana, clara, breve y profesional',
  aiInstructions: '',
};

export default function ConfiguracionPage() {
  const [configuration, setConfiguration] = useState<Configuration>(EMPTY);
  const [companyName, setCompanyName] = useState('Empresa');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch(
          `/api/settings?company=${encodeURIComponent(COMPANY)}`,
          { cache: 'no-store' },
        );
        const data = (await response.json()) as ResponseData;

        if (!response.ok || !data.ok || !data.configuration) {
          throw new Error(data.error || 'No se pudo cargar la configuración.');
        }

        setConfiguration(data.configuration);
        setCompanyName(data.company?.name || 'Empresa');
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'No se pudo cargar la configuración.');
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage('');

    try {
      const response = await fetch(
        `/api/settings?company=${encodeURIComponent(COMPANY)}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(configuration),
        },
      );

      const data = (await response.json()) as ResponseData;

      if (!response.ok || !data.ok || !data.configuration) {
        throw new Error(data.error || 'No se pudo guardar.');
      }

      setConfiguration(data.configuration);
      setMessage('Configuración guardada. La IA la usará en las siguientes conversaciones.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo guardar la configuración.');
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
          <h1>IA y ventas · {companyName}</h1>
          <p>Define cómo debe atender y vender la asistente de esta empresa.</p>
        </div>
        <button type="button" className={styles.back} onClick={() => window.location.assign('/configuracion')}>
          ← Volver a bandeja
        </button>
      </header>

      <form className={styles.card} onSubmit={save}>
        <label>
          <span>Nombre de la asesora</span>
          <input
            value={configuration.assistantName}
            onChange={(event) =>
              setConfiguration((current) => ({
                ...current,
                assistantName: event.target.value,
              }))
            }
            placeholder="Ejemplo: Daniela"
            disabled={loading}
          />
        </label>

        <label>
          <span>Tono de atención</span>
          <input
            value={configuration.tone}
            onChange={(event) =>
              setConfiguration((current) => ({
                ...current,
                tone: event.target.value,
              }))
            }
            placeholder="Ejemplo: Cercana, clara, breve y profesional"
            disabled={loading}
          />
        </label>

        <label>
          <span>Instrucciones comerciales para la IA</span>
          <textarea
            value={configuration.aiInstructions}
            onChange={(event) =>
              setConfiguration((current) => ({
                ...current,
                aiInstructions: event.target.value,
              }))
            }
            placeholder="Escribe aquí promociones, medios de pago, reglas de envío, venta cruzada, políticas y cuándo debe llamar a un asesor."
            rows={18}
            disabled={loading}
          />
        </label>

        <div className={styles.help}>
          Estas instrucciones son exclusivas de {companyName}. No cambian Aural, Maogo ni otras empresas.
        </div>

        {message ? <p className={styles.message}>{message}</p> : null}

        <button className={styles.save} type="submit" disabled={loading || saving}>
          {saving ? 'Guardando…' : 'Guardar configuración de IA'}
        </button>
      </form>
      </section>
    </main>
  );
}
