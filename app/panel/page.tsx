'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppSidebar } from '../components/AppSidebar';
import styles from './page.module.css';

type Session = {
  type: 'user' | 'platform' | 'bootstrap';
  userId: string | null;
  companyId: string;
  companySlug: string;
  companyName: string;
  fullName: string;
  roleKey: string;
};
type Capabilities = {
  inbox?: boolean;
  clients?: boolean;
  automations?: boolean;
  statistics?: boolean;
  configuration?: boolean;
  testAgent?: boolean;
};
type WorkspaceState = {
  session: Session;
  capabilities: Capabilities;
  commerce: boolean;
  staging: boolean;
};
type Module = { label: string; href: string; description: string; category: string };

function buildModules(workspace: WorkspaceState): Module[] {
  const { capabilities: c, session, commerce } = workspace;
  const management = session.roleKey === 'owner' || session.roleKey === 'admin';
  const modules: Module[] = [];
  if (c.inbox) modules.push({ label: 'Bandeja omnicanal', href: '/', description: 'Conversaciones y atención humana desde el módulo existente.', category: 'Atención' });
  if (c.clients) modules.push({ label: 'Clientes', href: '/clientes', description: 'Contactos e historial sujetos a los permisos de la empresa.', category: 'Atención' });
  if (c.clients && management && session.companySlug === 'emprende-con-maogo') modules.push({ label: 'Leads MAOGO', href: '/leads', description: 'Acceso al módulo de prospectos ya existente de MAOGO.', category: 'Atención' });
  if (c.statistics) modules.push({ label: 'Estadísticas', href: '/estadisticas', description: 'Indicadores de la empresa activa.', category: 'Seguimiento' });
  if (c.automations) modules.push({ label: 'Automatizaciones', href: '/automatizaciones', description: 'Flujos existentes de la empresa, sin crear conexiones nuevas.', category: 'Seguimiento' });
  // SEG-003: advisors may hold a granular configuration entitlement,
  // but the existing configuration pages and their APIs require a manager.
  // Never advertise links that the middleware will reject.
  if (c.configuration && management) {
    modules.push({ label: 'Asistente de IA', href: '/ia', description: 'Abrir el módulo de IA existente de esta empresa.', category: 'Administración' });
    modules.push({ label: 'Configuración de IA', href: '/configuracion/ia', description: 'Ajustar el asistente existente sin recrear instrucciones ni datos.', category: 'Administración' });
    modules.push({ label: 'Configuración', href: '/configuracion', description: 'Identidad, horarios, áreas y ajustes actuales de la empresa.', category: 'Administración' });
    modules.push({ label: 'Usuarios y asesores', href: '/usuarios', description: 'Administrar usuarios existentes de la empresa activa.', category: 'Administración' });
    modules.push({ label: 'Roles y permisos', href: '/usuarios/roles', description: 'Consultar y administrar roles autorizados en el módulo existente.', category: 'Administración' });
    modules.push({ label: 'Canales e integraciones', href: '/configuracion/integraciones', description: 'Ver conexiones de WhatsApp, Instagram y Messenger existentes, sin reconectarlas.', category: 'Administración' });
    modules.push({ label: 'Mi plan', href: '/configuracion/mi-plan', description: 'Ver plan vigente sin iniciar cobros.', category: 'Administración' });
  }
  if (commerce && management) {
    modules.push({ label: 'Pedidos', href: '/pedidos', description: 'Módulo opcional sujeto a la habilitación existente.', category: 'Comercio opcional' });
    modules.push({ label: 'Catálogo', href: '/catalogo', description: 'Funciones de catálogo según el acceso otorgado.', category: 'Comercio opcional' });
  }
  return modules;
}

export default function UnifiedWorkspacePage() {
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const sessionResponse = await fetch('/api/auth/session', { cache: 'no-store' });
        if (sessionResponse.status === 401) {
          window.location.assign('/login');
          return;
        }
        if (!sessionResponse.ok) throw new Error('No se pudo verificar la sesión.');
        const sessionPayload = (await sessionResponse.json()) as { session?: Session };
        const session = sessionPayload.session;
        if (!session || session.type !== 'user' || !session.userId || !session.companyId)
          throw new Error('Se requiere un usuario de empresa activo.');

        const capabilityResponse = await fetch('/api/auth/capabilities', { cache: 'no-store' });
        if (!capabilityResponse.ok) throw new Error('No fue posible verificar los permisos actuales.');
        const capabilityPayload = (await capabilityResponse.json()) as {
          ok?: boolean;
          capabilities?: Capabilities;
          staging?: boolean;
        };
        if (!capabilityPayload.ok || !capabilityPayload.capabilities)
          throw new Error('No fue posible verificar los permisos actuales.');

        const management = ['owner', 'admin'].includes(session.roleKey);
        let commerce = false;
        if (management) {
          try {
            const access = await fetch('/api/native-commerce/access', { cache: 'no-store' });
            if (access.ok) {
              const accessPayload = (await access.json()) as { ok?: boolean; enabled?: boolean };
              commerce = accessPayload.ok === true && accessPayload.enabled === true;
            }
          } catch {
            commerce = false;
          }
        }
        if (active) setWorkspace({ session, capabilities: capabilityPayload.capabilities, commerce, staging: capabilityPayload.staging === true });
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'No se pudo abrir el panel.');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  const modules = workspace ? buildModules(workspace) : [];
  const categories = ['Atención', 'Seguimiento', 'Administración', 'Comercio opcional'];
  return (
    <main className={styles.shell}>
      <AppSidebar companyName={workspace?.session.companyName ?? 'Empresa'} />
      <section className={styles.workspace}>
        <header className={styles.heading}>
          <span className={styles.eyebrow}>MW1 · Espacio unificado</span>
          <h1>Centro de operaciones</h1>
          <p>Una sola interfaz para las herramientas existentes de cada empresa. Los módulos se muestran según los permisos vigentes.</p>
        </header>
        {loading ? <p role="status" className={styles.notice}>Verificando tu empresa y sus permisos…</p> : null}
        {error ? <div role="alert" className={styles.error}>{error}</div> : null}
        {workspace ? (
          <>
            <div className={styles.identity}>
              <div>
                <span className={styles.small}>Empresa activa</span>
                <strong>{workspace.session.companyName}</strong>
              </div>
              <div>
                <span className={styles.small}>Sesión</span>
                <strong>{workspace.session.fullName || 'Usuario'} · {workspace.session.roleKey}</strong>
              </div>
              <div>
                <span className={styles.small}>Acceso</span>
                <strong>Según permisos de MW1</strong>
              </div>
            </div>
            {workspace.staging ? <p role="status" className={styles.notice}>Entorno de pruebas: el detalle ficticio de Bandeja es de solo lectura; los envíos, algunas acciones de Clientes y la conexión de canales permanecen restringidos deliberadamente. Estas restricciones no indican una falla de ATOGOB o MAOGO.</p> : null}
            {modules.length === 0 ? <p className={styles.notice}>Tu usuario no tiene módulos habilitados en este momento. Contacta al administrador de tu empresa.</p> : null}
            {categories.map(category => {
              const items = modules.filter(module => module.category === category);
              return items.length ? (
                <section className={styles.group} key={category}>
                  <h2>{category}</h2>
                  <div className={styles.cards}>
                    {items.map(module => (
                      <Link className={styles.card} key={module.href} href={module.href}>
                        <span className={styles.cardTitle}>{module.label} <span aria-hidden="true">↗</span></span>
                        <span className={styles.description}>{module.description}</span>
                      </Link>
                    ))}
                  </div>
                </section>
              ) : null;
            })}
            <p className={styles.footerNote}>Este panel reutiliza los servicios existentes. No conecta canales, no mueve datos y no cambia planes ni pagos.</p>
          </>
        ) : null}
      </section>
    </main>
  );
}
