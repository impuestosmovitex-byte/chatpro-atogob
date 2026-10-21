'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './page.module.css';

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [staging, setStaging] = useState(false);

  useEffect(() => {
    setStaging(window.location.hostname === 'mw1-web-staging-staging.up.railway.app');
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      });

      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };

      if (!response.ok || !data.ok) {
        setError(data.error || 'No se pudo iniciar sesión.');
        return;
      }

      const destination = new URLSearchParams(window.location.search).get('next');
      const safeDestination = destination && destination.startsWith('/') && !destination.startsWith('//')
        ? destination
        : '/';
      router.replace(staging && safeDestination === '/' ? '/pedidos' : safeDestination);
      router.refresh();
    } catch {
      setError('No se pudo conectar con Chat Pro. Intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.shell}>
      <section className={styles.card}>
        <div className={styles.mark}>MW1</div>
        <p className={styles.eyebrow}>MW1</p>
        <h1>Iniciar sesión</h1>
        <p className={styles.copy}>
          Ingresa tu identificación o código de acceso y tu contraseña.
        </p>

        <form className={styles.form} onSubmit={submit}>
          <label htmlFor="identifier">Identificación o código</label>
          <input
            id="identifier"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            autoComplete="username"
            autoFocus
            placeholder={staging ? 'MW1DEMO' : 'Ejemplo: 1020304050'}
          />

          <label htmlFor="password">Contraseña</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />

          <p className={styles.copy}>
            {staging
              ? 'Demo Supermercado: escribe MW1DEMO y la contraseña configurada para el propietario de pruebas. No uses claves de ATOGOB.'
              : 'Para configurar la primera cuenta de la empresa, deja vacía la identificación y usa la contraseña principal actual.'}
          </p>

          {error ? <p className={styles.error}>{error}</p> : null}
          <button type="submit" disabled={loading || !password}>
            {loading ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>
      </section>
    </main>
  );
}
