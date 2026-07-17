'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import styles from './AppSidebar.module.css';

type AppSidebarProps = {
  companyName?: string;
};

type CompanyOption = {
  id: string;
  slug: string;
  name: string;
  roleKey: string;
  roleName: string;
};

type Session = {
  companySlug?: string;
  companyName?: string;
  roleKey?: string;
  userId?: string | null;
};

type Capabilities = {
  inbox: boolean;
  clients: boolean;
  automations: boolean;
  configuration: boolean;
  testAgent: boolean;
  health: boolean;
};

const baseNavigation: Array<{
  href: string;
  label: string;
  icon: string;
  exact?: boolean;
  capability: keyof Capabilities;
}> = [
  {
    href: '/',
    label: 'Bandeja',
    icon: '◉',
    exact: true,
    capability: 'inbox',
  },
  {
    href: '/clientes',
    label: 'Clientes',
    icon: '◌',
    capability: 'clients',
  },
  {
    href: '/automatizaciones',
    label: 'Automatizaciones',
    icon: '◈',
    capability: 'automations',
  },
  {
    href: '/plantillas-whatsapp',
    label: 'Plantillas WhatsApp',
    icon: '▤',
    capability: 'automations',
  },
  {
    href: '/salud',
    label: 'Salud y alertas',
    icon: '!',
    capability: 'health',
  },
];

function isActive(pathname: string, href: string, exact?: boolean): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}


export function AppSidebar({
  companyName = 'Empresa',
}: AppSidebarProps) {
  const pathname = usePathname();
  const [roleKey, setRoleKey] = useState('');
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [activeCompany, setActiveCompany] = useState(companyName);
  const [activeSlug, setActiveSlug] = useState('');
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [changingCompany, setChangingCompany] = useState(false);
  const [message, setMessage] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        const sessionResponse = await fetch('/api/auth/session', {
          cache: 'no-store',
        });
        const sessionData = (await sessionResponse.json()) as {
          session?: Session;
        };

        if (!alive || !sessionResponse.ok || !sessionData.session) return;

        const session = sessionData.session;
        const normalizedRoleKey =
          session.roleKey?.trim().toLowerCase() || '';

        setRoleKey(normalizedRoleKey);
        setActiveCompany(session.companyName?.trim() || companyName);
        setActiveSlug(session.companySlug?.trim().toLowerCase() || '');

        try {
          const capabilitiesResponse = await fetch(
            '/api/auth/capabilities',
            { cache: 'no-store' },
          );
          const capabilitiesData = (await capabilitiesResponse.json()) as {
            ok?: boolean;
            capabilities?: Capabilities;
          };

          if (
            alive &&
            capabilitiesResponse.ok &&
            capabilitiesData.ok &&
            capabilitiesData.capabilities
          ) {
            setCapabilities(capabilitiesData.capabilities);
          }
        } catch {
          const fullAccess =
            normalizedRoleKey === 'owner' ||
            normalizedRoleKey === 'admin';

          if (alive) {
            setCapabilities({
              inbox: true,
              clients: true,
              automations: fullAccess,
              configuration: fullAccess,
              testAgent: fullAccess,
              health: fullAccess,
            });
          }
        }

        if (!session.userId) return;

        const companiesResponse = await fetch('/api/auth/companies', {
          cache: 'no-store',
        });
        const companiesData = (await companiesResponse.json()) as {
          ok?: boolean;
          companies?: CompanyOption[];
        };

        if (alive && companiesResponse.ok && companiesData.ok) {
          setCompanies(companiesData.companies || []);
        }
      } catch {
        // La navegación sigue funcionando aunque no se cargue el selector.
      }
    }

    void load();

    return () => {
      alive = false;
    };
  }, [companyName]);

  const fullAccess = roleKey === 'owner' || roleKey === 'admin';
  const effectiveCapabilities: Capabilities = capabilities ?? {
    inbox: true,
    clients: true,
    automations: fullAccess,
    configuration: fullAccess,
    testAgent: fullAccess,
    health: fullAccess,
  };

  const navigation: Array<{
    href: string;
    label: string;
    icon: string;
    exact?: boolean;
  }> = [
    ...baseNavigation.filter(
      (item) => effectiveCapabilities[item.capability],
    ),
    ...(effectiveCapabilities.configuration
      ? [
          {
            href: '/configuracion',
            label: 'Configuración',
            icon: '⚙',
          },
        ]
      : []),
  ];

  async function changeCompany(companySlug: string) {
    if (!companySlug || companySlug === activeSlug || changingCompany) return;

    setMessage('');
    setChangingCompany(true);

    try {
      const response = await fetch('/api/auth/switch-company', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ companySlug }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };

      if (!response.ok || !data.ok) {
        setMessage(data.error || 'No se pudo cambiar de empresa.');
        return;
      }

      window.location.assign('/');
    } catch {
      setMessage('No se pudo cambiar de empresa.');
    } finally {
      setChangingCompany(false);
    }
  }

  async function logout() {
    setLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      window.location.assign('/login');
    }
  }

  const canSwitch = companies.length > 1;

  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <span className={styles.dot} />
        <span>Chat Pro</span>
      </div>

      <nav className={styles.nav} aria-label="Navegación principal">
        {navigation.map((item) => {
          const active = isActive(pathname, item.href, item.exact);

          if ('disabled' in item && item.disabled) {
            return (
              <span
                className={`${styles.item} ${styles.disabled}`}
                key={item.label}
                aria-disabled="true"
              >
                <span>{item.icon}</span>
                {item.label}
              </span>
            );
          }

          return (
            <Link
              className={`${styles.item} ${active ? styles.active : ''}`}
              href={item.href}
              key={item.href}
            >
              <span>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className={styles.footer}>
        <span className={styles.footerAvatar}>
          {activeCompany.trim().slice(0, 1).toUpperCase() || 'E'}
        </span>
        <span className={styles.companyBlock}>
          <strong>{activeCompany}</strong>
          <small>{canSwitch ? 'Empresa activa' : 'Empresa'}</small>
        </span>
      </div>

      {canSwitch ? (
        <label className={styles.companyPicker}>
          <span>Cambiar empresa</span>
          <select
            value={activeSlug}
            onChange={(event) => void changeCompany(event.target.value)}
            disabled={changingCompany}
          >
            {companies.map((company) => (
              <option key={company.id} value={company.slug}>
                {company.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {message ? <p className={styles.companyError}>{message}</p> : null}

      <button
        type="button"
        onClick={() => void logout()}
        disabled={loggingOut}
        className={styles.logout}
      >
        {loggingOut ? 'Cerrando sesión…' : 'Cerrar sesión'}
      </button>
    </aside>
  );
}
