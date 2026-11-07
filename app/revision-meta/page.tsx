import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getInboxSession, INBOX_SESSION_COOKIE } from '../lib/inbox-auth';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

const exampleMessages = [
  { author: 'Cliente de prueba', type: 'customer', message: 'Hola, ¿tienen pantalones cargo disponibles?' },
  { author: 'Asistente IA · demostración', type: 'ai', message: '¡Hola! Tenemos opciones de pantalón cargo. ¿Qué talla y color buscas?' },
  { author: 'Cliente de prueba', type: 'customer', message: 'Talla M, preferiblemente negro.' },
  { author: 'Asistente IA · demostración', type: 'ai', message: 'Perfecto. Puedo ayudarte a consultar las opciones en talla M y color negro.' },
] as const;

export default async function MetaReviewExamplePage() {
  const staging = process.env.MW1_STAGING_MODE === 'true';
  if (!staging) redirect('/');

  const cookieStore = await cookies();
  const session = await getInboxSession(cookieStore.get(INBOX_SESSION_COOKIE)?.value);
  if (!session) redirect('/login?company=piloto-mw1-prueba&next=%2Frevision-meta');
  if (session.type !== 'user' || session.companySlug !== 'piloto-mw1-prueba' || !session.userId) {
    redirect('/');
  }

  return (
    <main className={styles.page}>
      <div className={styles.wrap}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>MW1 · REVISIÓN DE META · SOLO STAGING</p>
            <h1>Demostración de atención comercial</h1>
            <p>Ejemplo ilustrativo de la experiencia del CRM, inspirado en los flujos comerciales de ATOGOB.</p>
          </div>
          <Link href="/" className={styles.back}>Volver al panel</Link>
        </header>

        <aside className={styles.notice}>
          <strong>Ejemplo simulado, no es una conversación real.</strong> No utiliza la API de WhatsApp,
          no envía mensajes, no consulta clientes reales y no demuestra por sí solo la aprobación de
          los permisos de Meta. Los mensajes y las plantillas de esta página son ficticios.
        </aside>

        <section className={styles.grid}>
          <div className={styles.card}>
            <p className={styles.kicker}>Bandeja de WhatsApp · Ejemplo</p>
            <h2>Consulta de productos</h2>
            <p className={styles.subline}>Cliente de prueba · Teléfono oculto · Modo solo lectura</p>
            <div className={styles.messages}>
              {exampleMessages.map((item, index) => (
                <div className={item.type === 'ai' ? styles.ai : styles.customer} key={index}>
                  <small>{item.author}</small>
                  <p>{item.message}</p>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.side}>
            <section className={styles.card}>
              <p className={styles.kicker}>Plantilla ilustrativa · No conectada a Meta</p>
              <h2>Seguimiento de pedido</h2>
              <dl>
                <div><dt>Categoría</dt><dd>Utilidad (ejemplo)</dd></div>
                <div><dt>Idioma</dt><dd>Español</dd></div>
                <div><dt>Estado</dt><dd>Demostración, sin aprobación real</dd></div>
              </dl>
              <p className={styles.template}>Hola, {'{{1}}'}. Tenemos novedades sobre tu pedido {'{{2}}'}.</p>
            </section>

            <section className={styles.card}>
              <p className={styles.kicker}>Automatización ilustrativa</p>
              <h2>Atención asistida con IA</h2>
              <p>Un mensaje entrante puede iniciar la clasificación de una consulta y una respuesta sugerida. Esta pantalla no ejecuta ninguna automatización.</p>
              <p className={styles.readOnly}>Solo lectura · Sin botones de envío ni edición</p>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}
