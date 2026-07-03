'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import styles from './AppSidebar.module.css';

type AppSidebarProps = {
  companyName?: string;
};

type Session = {
  roleKey?: string;
};

const baseNavigation = [
  { href: '/', label: 'Bandeja', icon: '◉', exact: true },
  { href: '/clientes', label: 'Clientes', icon: '◌' },
  {
    href: '/automatizaciones',
    label: 'Automatizaciones',
    icon: '◈',
    disabled: true,
  },
];

function isActive(pathname: string, href: string, exact?: boolean): boolean {
  if (exact) {
    return pathname === href;
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

function canManageConfiguration(roleKey: string): boolean {
  return roleKey === 'owner' || roleKey === 'admin';
}

export function AppSidebar({
  companyName = 'ATOGOB',
}: AppSidebarProps) {
  const pathname = usePathname();
  const [roleKey, setRoleKey] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let active = true;

    void fetch('/api/auth/session', { cache: 'no-store' })
      .then(async (response) => {
        const data = (await response.json()) as {
          session?: Session;
        };

        if (active && response.ok) {
          setRoleKey(data.session?.roleKey?.trim().toLowerCase() ?? '');
        }
      })
      .catch(() => {
        if (active) setRoleKey('');
      });

    return () => {
      active = false;
    };
  }, []);

  const navigation = canManageConfiguration(roleKey)
    ? [
        ...baseNavigation,
        { href: '/configuracion', label: 'Configuración', icon: '⚙' },
      ]
    : baseNavigation;

  async function logout() {
    setLoggingOut(true);

    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      window.location.assign('/login');
    }
  }

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
          {companyName.trim().slice(0, 1).toUpperCase() || 'E'}
        </span>
        <span>
          <strong>{companyName}</strong>
          <small>WhatsApp conectado</small>
        </span>
      </div>

      <button
        type="button"
        onClick={() => void logout()}
        disabled={loggingOut}
        style={{
          margin: '0 14px 16px',
          padding: '10px 12px',
          border: '1px solid rgba(255,255,255,.18)',
          borderRadius: 10,
          background: 'transparent',
          color: '#fff',
          textAlign: 'left',
          cursor: loggingOut ? 'wait' : 'pointer',
          fontWeight: 700,
        }}
      >
        {loggingOut ? 'Cerrando sesión…' : 'Cerrar sesión'}
      </button>
    </aside>
  );
}
