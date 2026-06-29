'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './page.module.css';

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
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
      router.replace(
        destination && destination.startsWith('/') ? destination : '/',
      );
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
        <div className={styles.mark}>CP</div>
        <p className={styles.eyebrow}>CHAT PRO</p>
        <h1>Acceso al Inbox</h1>
        <p className={styles.copy}>
          Ingresa la contraseña de tu equipo para abrir las conversaciones.
        </p>

        <form className={styles.form} onSubmit={submit}>
          <label htmlFor="password">Contraseña</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            autoFocus
            required
          />
          {error ? <p className={styles.error}>{error}</p> : null}
          <button type="submit" disabled={loading || !password}>
            {loading ? 'Ingresando…' : 'Ingresar al Inbox'}
          </button>
        </form>
      </section>
    </main>
  );
}
