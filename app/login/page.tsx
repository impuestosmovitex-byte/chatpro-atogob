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
  const [platformLogin,setPlatformLogin]=useState(false);

  useEffect(() => {
    setStaging(window.location.hostname === 'mw1-web-staging-staging.up.railway.app');
    setPlatformLogin(new URLSearchParams(window.location.search).get('mode')==='platform');
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier, password, company:platformLogin?'__platform__':new URLSearchParams(window.location.search).get('company')||undefined }),
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
      router.replace(platformLogin && safeDestination==='/' ? '/admin' : staging && safeDestination==='/' ? '/pedidos' : safeDestination);
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
        <h1>{platformLogin?'Administración general MW1':'Iniciar sesión'}</h1>
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
            placeholder={platformLogin?'Identificación del superadministrador':staging ? 'MW1DEMO' : 'Ejemplo: 1020304050'}
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
            {platformLogin ? 'Acceso independiente de las empresas. Aquí se administran los planes y las compañías de MW1.' : staging
              ? 'Cuenta de empresa de demostración. No uses claves de ATOGOB.'
              : 'Para configurar la primera cuenta de la empresa, deja vacía la identificación y usa la contraseña principal actual.'}
          </p>

          {staging?<p className={styles.copy}>{platformLogin?<a href="/login?company=mw1-demo-mercado">Entrar como usuario de empresa demo</a>:<a href="/login?mode=platform&next=%2Fadmin">Entrar como superadministrador MW1</a>}</p>:null}
          {error ? <p className={styles.error}>{error}</p> : null}
          <button type="submit" disabled={loading || !password}>
            {loading ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>
      </section>
    </main>
  );
}
