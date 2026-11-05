import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { AppSidebar } from '../../../components/AppSidebar';
import { getInboxSession, INBOX_SESSION_COOKIE } from '../../../lib/inbox-auth';
import { WhatsappCoexistencePilotDiagnostics } from './WhatsappCoexistencePilotDiagnostics';
import styles from '../page.module.css';

export const dynamic = 'force-dynamic';

/**
 * Standalone, STAGING-ONLY pilot diagnostic. No Meta OAuth, onboarding,
 * webhook subscriptions, phone provisioning, or token exchange.
 * Access is restricted to a valid signed owner/admin user session on the
 * dedicated pilot tenant and exact staging services.
 */
export default async function WhatsappCoexistenciaPruebaPage() {
  const cookiesStore = await cookies();
  const session = await getInboxSession(
    cookiesStore.get(INBOX_SESSION_COOKIE)?.value,
  );
  if (!session) {
    redirect(
      '/login?company=piloto-mw1-prueba&next=%2Fconfiguracion%2Fintegraciones%2Fwhatsapp-coexistencia-prueba',
    );
  }
  if (process.env.MW1_STAGING_MODE !== 'true' ||
      process.env.CHATPRO_API_URL?.trim().replace(/\/$/, '') !==
        'https://mw1-api-staging-staging.up.railway.app' ||
      session.type !== 'user' || !session.userId ||
      session.companySlug !== 'piloto-mw1-prueba' ||
      !['owner', 'admin'].includes(session.roleKey.trim().toLowerCase())) {
    notFound();
  }

  return (
    <main className={styles.shell}>
      <AppSidebar companyName={session.companyName} />
      <section className={styles.workspace}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>MW1 · PILOTO DE STAGING</p>
            <h1>WhatsApp Business + MW1</h1>
            <p>Diagnóstico independiente de coexistencia para la empresa piloto.</p>
          </div>
          <a className={styles.back} href="/configuracion/integraciones">
            ← Integraciones
          </a>
        </header>
        <div style={{ maxWidth: 960, margin: '0 auto', display: 'grid', gap: 18 }}>
          <section className={styles.detail} style={{ minHeight: 0 }}>
            <h2>Preparación segura de coexistencia</h2>
            <p className={styles.description}>
              Esta pantalla no conecta números ni activa WhatsApp. Nos permite
              revisar por separado el entorno antes de iniciar la autorización
              oficial de Meta con un número nuevo de prueba.
            </p>
            <WhatsappCoexistencePilotDiagnostics />
          </section>
          <section className={styles.detail} style={{ minHeight: 0 }}>
            <h2>Qué falta para la prueba real</h2>
            <ol style={{ lineHeight: 1.8, paddingLeft: 22 }}>
              <li>Confirmar una configuración oficial de Meta que admita WhatsApp Business App + Cloud API (coexistencia).</li>
              <li>Preparar un número independiente, activo en WhatsApp Business App, que no pertenezca a las empresas operativas.</li>
              <li>Completar el flujo exclusivo con validación de cuenta, número y autorización del titular.</li>
              <li>Verificar el webhook firmado, el aislamiento por empresa y el consentimiento antes de solicitar historial o contactos.</li>
            </ol>
            <p className={styles.notice}>
              Sin conexión activa: no se copiarán conversaciones, no se enviarán
              mensajes ni se modificarán las integraciones de ATOGOB o MAOGO.
            </p>
          </section>
        </div>
      </section>
    </main>
  );
}
