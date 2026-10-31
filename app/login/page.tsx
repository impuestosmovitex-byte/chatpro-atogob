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
  const [companySlug,setCompanySlug]=useState('');

  useEffect(() => {
    setStaging(window.location.hostname === 'mw1-web-staging-staging.up.railway.app');
    const params=new URLSearchParams(window.location.search);
    setPlatformLogin(params.get('mode')==='platform');
    setCompanySlug(params.get('company')||'');
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if(staging&&!platformLogin&&!companySlug){
      setError('Selecciona una empresa de pruebas con su enlace de acceso. Para ATOGOB operativo utiliza el acceso a MW1 producción que aparece arriba.');
      return;
    }
    setLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier, password, company:platformLogin?'__platform__':companySlug||undefined }),
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
      const allowedReturn = destination && destination.startsWith('/') &&
        !destination.startsWith('//') && !destination.includes('\\\\') &&
        !destination.startsWith('/admin') && !destination.startsWith('/api/') &&
        !destination.startsWith('/login');
      const safeDestination = allowedReturn ? destination : '/';
      router.replace(platformLogin && safeDestination==='/' ? '/admin' : safeDestination);
      router.refresh();
    } catch {
      setError('No se pudo conectar con MW1. Intenta nuevamente.');
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
          {companySlug?'Ingresa con las credenciales de tu empresa.':'Ingresa tu identificación y contraseña para acceder a MW1.'}
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


          {!platformLogin&&<p className={styles.copy} style={{margin:'6px 0 4px'}}>
            <a href={'/recuperar-acceso'+(typeof window!=='undefined'&&
              new URLSearchParams(window.location.search).get('company')
              ? '?company='+encodeURIComponent(new URLSearchParams(window.location.search).get('company')||'')
              :'')}>¿Olvidaste tu contraseña?</a>
          </p>}
          {error ? <p className={styles.error}>{error}</p> : null}
          <button type="submit" disabled={loading || !password || (staging&&!platformLogin&&!companySlug)}>
            {loading ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>
        {staging&&<p className={styles.copy} style={{margin:'14px 0 0',fontSize:12,textAlign:'center'}}>
          {platformLogin?<a href="/login">Acceso empresarial</a>:companySlug
            ?<span>Entorno piloto · <a href="/login?mode=platform&next=%2Fadmin">Administración de MW1</a></span>
            :<span>¿Ya eres cliente? <a href="https://chatpro-web-production.up.railway.app/login">Entrar al MW1 actual</a> · <a href="/login?mode=platform&next=%2Fadmin">Administración</a></span>}
        </p>}
      </section>
    </main>
  );
}
