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
        const genericAuthError = !data.error || /^(Unauthorized|No autorizado\.?|Forbidden)$/i.test(data.error);
        setError(response.status===401 || genericAuthError
          ? 'No pudimos validar el código de acceso o la contraseña. Verifica los datos e inténtalo de nuevo.'
          : data.error || 'No se pudo iniciar sesión.');

        return;
      }

      const destination = new URLSearchParams(window.location.search).get('next');
      const safeDestination = destination && destination.startsWith('/') && !destination.startsWith('//')
        ? destination
        : '/';
      router.replace(platformLogin && safeDestination==='/' ? '/admin' : safeDestination);
      router.refresh();
    } catch {
      setError('No se pudo conectar con Chat Pro. Intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={`${styles.shell} ${platformLogin?styles.platformShell:''}`}>
      <section className={styles.card}>
        <div className={styles.mark}>MW1</div>
        <p className={styles.eyebrow}>{platformLogin?'ACCESO PRIVADO · PLATAFORMA':'MW1 · ACCESO EMPRESARIAL'}</p>
        <h1>{platformLogin?'Administración de MW1':'Accede a tu empresa'}</h1>
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
            placeholder={platformLogin?'Identificación de administrador':'Tu código de acceso'}
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
            {platformLogin
              ? 'Área privada y separada de las cuentas de clientes. Solo personal autorizado de MW1.'
              : staging
                ? 'Usa las credenciales de tu empresa. Este acceso no permite administrar la plataforma.'
                : 'Ingresa con las credenciales de tu empresa. Si necesitas acceso, comunícate con su administrador.'}
          </p>

          {!platformLogin&&<p className={styles.copy} style={{margin:'6px 0 4px'}}>
            <a href={'/recuperar-acceso'+(typeof window!=='undefined'&&
              new URLSearchParams(window.location.search).get('company')
              ? '?company='+encodeURIComponent(new URLSearchParams(window.location.search).get('company')||'')
              :'')}>¿Olvidaste tu contraseña?</a>
          </p>}
          {error ? <p className={styles.error}>{error}</p> : null}
          <button type="submit" disabled={loading || !password}>
            {loading ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>
      </section>
    </main>
  );
}
