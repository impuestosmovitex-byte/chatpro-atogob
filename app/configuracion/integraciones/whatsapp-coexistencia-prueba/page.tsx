import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
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
  // Keep every original staging, tenant and admin restriction. Instead of
  // displaying Next.js's misleading generic 404, explain access/configuration
  // blockers without ever rendering the diagnostic client on a failed gate.
  const pilotAdmin =
    session.type === 'user' && Boolean(session.userId) &&
    session.companySlug === 'piloto-mw1-prueba' &&
    ['owner', 'admin'].includes(session.roleKey.trim().toLowerCase());
  const stagingModeReady = process.env.MW1_STAGING_MODE === 'true';
  const stagingApiReady = process.env.CHATPRO_API_URL?.trim().replace(/\/$/, '') ===
    'https://mw1-api-staging-staging.up.railway.app';

  if (!pilotAdmin || !stagingModeReady || !stagingApiReady) {
    // This is an ACCESS-DENIED view, never a relaxed authorization path.
    // Show environment readiness only to an already verified pilot admin.
    return (
      <main className={styles.shell}>
        <AppSidebar companyName={session.companyName} />
        <section className={styles.workspace}>
          <header className={styles.header}>
            <div>
              <p className={styles.eyebrow}>MW1 · PILOTO DE STAGING</p>
              <h1>Diagnóstico no disponible</h1>
              <p>La página existe, pero aún no se cumplen sus requisitos de acceso.</p>
            </div>
            <a className={styles.back} href="/configuracion/integraciones">
              ← Integraciones
            </a>
          </header>
          <section className={styles.detail} style={{ maxWidth: 780, minHeight: 0, margin: '0 auto' }}>
            {!pilotAdmin ? (
              <>
                <h2>Inicia sesión en la empresa piloto</h2>
                <p className={styles.description}>
                  Esta prueba solo está disponible para usuarios administradores
                  de Piloto MW1 Prueba. La sesión actual no cumple ese requisito.
                </p>
                <a href="/login?company=piloto-mw1-prueba&next=%2Fconfiguracion%2Fintegraciones%2Fwhatsapp-coexistencia-prueba">
                  Abrir inicio de sesión del piloto
                </a>
              </>
            ) : (
              <>
                <h2>Configuración de staging pendiente</h2>
                <p className={styles.description}>
                  Tu usuario sí tiene permiso para el piloto. El servidor todavía
                  necesita completar las siguientes verificaciones técnicas.
                  No cambies variables ni números por tu cuenta.
                </p>
                <dl className={styles.details}>
                  <div><dt>Modo staging de la web</dt>
                    <dd>{stagingModeReady ? 'Correcto' : 'No habilitado'}</dd></div>
                  <div><dt>API exclusiva de staging</dt>
                    <dd>{stagingApiReady ? 'Correcta' : 'No coincide con la esperada'}</dd></div>
                </dl>
              </>
            )}
            <p className={styles.notice}>
              No se abrió Meta, no se conectaron números y ninguna integración
              operativa fue modificada por esta página.
            </p>
          </section>
        </section>
      </main>
    );
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
