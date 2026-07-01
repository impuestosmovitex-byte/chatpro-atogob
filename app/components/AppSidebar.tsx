 'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './AppSidebar.module.css';

type AppSidebarProps = {
  companyName?: string;
};

const navigation = [
  { href: '/', label: 'Bandeja', icon: '◉', exact: true },
  { href: '/clientes', label: 'Clientes', icon: '◌' },
  { href: '/usuarios', label: 'Usuarios', icon: '◍' },
  {
    href: '/automatizaciones',
    label: 'Automatizaciones',
    icon: '◈',
    disabled: true,
  },
  { href: '/configuracion', label: 'Configuración', icon: '⚙' },
];

function isActive(pathname: string, href: string, exact?: boolean): boolean {
  if (exact) {
    return pathname === href;
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppSidebar({
  companyName = 'ATOGOB',
}: AppSidebarProps) {
  const pathname = usePathname();

  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <span className={styles.dot} />
        <span>Chat Pro</span>
      </div>

      <nav className={styles.nav} aria-label="Navegación principal">
        {navigation.map((item) => {
          const active = isActive(pathname, item.href, item.exact);

          if (item.disabled) {
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
    </aside>
  );
}
