'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { AppSidebar } from '../../components/AppSidebar';
import styles from './page.module.css';


type Permission = {
  key: string;
  name: string;
  description: string;
};

type Role = {
  key: string;
  name: string;
  description: string;
  scope: 'base' | 'custom';
  memberCount: number;
  permissions: Permission[];
};

type FormData = {
  name: string;
  description: string;
  permissionKeys: string[];
};

type ResponseData = {
  ok?: boolean;
  error?: string;
  message?: string;
  company?: { name?: string };
  permissions?: Permission[];
  roles?: Role[];
};

const EMPTY: FormData = {
  name: '',
  description: '',
  permissionKeys: [],
};

function category(key: string): string {
  const prefix = key.split('.')[0]?.toLowerCase() || 'otros';
  const names: Record<string, string> = {
    inbox: 'Bandeja',
    conversation: 'Bandeja',
    conversations: 'Bandeja',
    client: 'Clientes',
    clients: 'Clientes',
    customer: 'Clientes',
    customers: 'Clientes',
    user: 'Usuarios',
    users: 'Usuarios',
    role: 'Roles y permisos',
    roles: 'Roles y permisos',
    setting: 'Configuración',
    settings: 'Configuración',
    automation: 'Automatizaciones',
    automations: 'Automatizaciones',
    storefront: 'Tienda',
    sales: 'Ventas',
    order: 'Pedidos',
    orders: 'Pedidos',
    inventory: 'Inventario',
    product: 'Productos',
    products: 'Productos',
    marketing: 'Publicidad',
    ads: 'Publicidad',
  };

  return names[prefix] || 'Otros permisos';
}

export default function RolesPage() {
  const [companyName, setCompanyName] = useState('Empresa');
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [form, setForm] = useState<FormData>(EMPTY);
  const [editingKey, setEditingKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const editingRole = useMemo(
    () => roles.find((role) => role.key === editingKey) ?? null,
    [editingKey, roles],
  );

  const groups = useMemo(() => {
    const grouped = new Map<string, Permission[]>();

    for (const permission of permissions) {
      const title = category(permission.key);
      const list = grouped.get(title) ?? [];
      list.push(permission);
      grouped.set(title, list);
    }

    return Array.from(grouped.entries()).sort(([left], [right]) =>
      left.localeCompare(right),
    );
  }, [permissions]);

  async function load() {
    setLoading(true);
    setError('');

    try {
      const response = await fetch(
        `/api/roles`,
        { cache: 'no-store' },
      );
      const data = (await response.json()) as ResponseData;

      if (!response.ok || !data.ok) {
        throw new Error(data.message || data.error || 'No se pudieron cargar los roles.');
      }

      setCompanyName(data.company?.name || 'Empresa');
      setPermissions(data.permissions || []);
      setRoles(data.roles || []);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'No se pudieron cargar los roles.',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function resetForm() {
    setEditingKey('');
    setForm(EMPTY);
    setError('');
    setMessage('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function editRole(role: Role) {
    setEditingKey(role.scope === 'custom' ? role.key : '');
    setForm({
      name: role.scope === 'custom' ? role.name : `${role.name} ${companyName}`,
      description: role.description,
      permissionKeys: role.permissions.map((permission) => permission.key),
    });
    setError('');
    setMessage('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function togglePermission(key: string) {
    setForm((current) => ({
      ...current,
      permissionKeys: current.permissionKeys.includes(key)
        ? current.permissionKeys.filter((item) => item !== key)
        : [...current.permissionKeys, key],
    }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    setError('');

    try {
      const response = await fetch(
        `/api/roles`,
        {
          method: editingKey ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(
            editingKey ? { roleKey: editingKey, ...form } : form,
          ),
        },
      );

      const data = (await response.json()) as ResponseData;

      if (!response.ok || !data.ok) {
        throw new Error(data.message || data.error || 'No se pudo guardar el rol.');
      }

      setMessage(data.message || 'Rol guardado correctamente.');
      setEditingKey('');
      setForm(EMPTY);
      await load();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'No se pudo guardar el rol.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className={styles.shell}>
      <AppSidebar companyName={companyName} />

      <section className={styles.workspace}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>EQUIPO Y ACCESOS</p>
            <h1>Roles y permisos</h1>
            <p>
              Define qué puede ver y hacer cada tipo de usuario de{' '}
              {companyName}.
            </p>
          </div>

          <div className={styles.headerActions}>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={() => window.location.assign('/usuarios')}
            >
              ← Usuarios
            </button>
            <button
              className={styles.primaryButton}
              type="button"
              onClick={resetForm}
            >
              + Crear rol
            </button>
          </div>
        </header>

        {error ? <div className={styles.error}>{error}</div> : null}
        {message ? <div className={styles.success}>{message}</div> : null}

        <div className={styles.layout}>
          <section className={styles.editor}>
            <div className={styles.cardHeading}>
              <p>{editingRole ? 'Editar rol personalizado' : 'Nuevo rol'}</p>
              <h2>
                {editingRole
                  ? editingRole.name
                  : 'Configura el nivel de acceso'}
              </h2>
            </div>

            <form className={styles.form} onSubmit={save}>
              <label>
                <span>Nombre del rol</span>
                <input
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="Ejemplo: Jefe de ventas"
                  disabled={loading || saving}
                />
              </label>

              <label>
                <span>Descripción</span>
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  placeholder="Ejemplo: Coordina el equipo comercial y revisa resultados."
                  disabled={loading || saving}
                />
              </label>

              <div className={styles.permissionHeader}>
                <div>
                  <strong>Permisos</strong>
                  <p>
                    {form.permissionKeys.length} seleccionado
                    {form.permissionKeys.length === 1 ? '' : 's'}
                  </p>
                </div>
                <button
                  className={styles.clearButton}
                  type="button"
                  disabled={!form.permissionKeys.length || saving}
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      permissionKeys: [],
                    }))
                  }
                >
                  Limpiar
                </button>
              </div>

              <div className={styles.permissionGroups}>
                {groups.map(([title, items]) => (
                  <fieldset className={styles.group} key={title}>
                    <legend>{title}</legend>
                    {items.map((permission) => (
                      <label className={styles.permission} key={permission.key}>
                        <input
                          type="checkbox"
                          checked={form.permissionKeys.includes(permission.key)}
                          onChange={() => togglePermission(permission.key)}
                          disabled={loading || saving}
                        />
                        <span>
                          <strong>{permission.name}</strong>
                          <small>{permission.description}</small>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                ))}
              </div>

              <div className={styles.formActions}>
                <button
                  className={styles.primaryButton}
                  type="submit"
                  disabled={
                    loading ||
                    saving ||
                    !form.name.trim() ||
                    !form.permissionKeys.length
                  }
                >
                  {saving
                    ? 'Guardando…'
                    : editingRole
                      ? 'Guardar cambios'
                      : 'Crear rol'}
                </button>

                {(editingRole ||
                  form.name ||
                  form.description ||
                  form.permissionKeys.length) && (
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    disabled={saving}
                    onClick={resetForm}
                  >
                    Cancelar
                  </button>
                )}
              </div>
            </form>
          </section>

          <section className={styles.roleListCard}>
            <div className={styles.cardHeading}>
              <p>Roles disponibles</p>
              <h2>{loading ? 'Cargando…' : `${roles.length} roles`}</h2>
            </div>

            <div className={styles.notice}>
              Los roles base son plantillas. Selecciona “Usar como base” para
              crear una versión propia de {companyName} y modificar sus
              permisos.
            </div>

            {loading ? (
              <div className={styles.empty}>Cargando roles y permisos…</div>
            ) : (
              <div className={styles.roleList}>
                {roles.map((role) => (
                  <article className={styles.role} key={role.key}>
                    <div className={styles.roleTop}>
                      <div>
                        <div className={styles.roleTitle}>
                          <h3>{role.name}</h3>
                          <span
                            className={
                              role.scope === 'custom'
                                ? styles.customBadge
                                : styles.baseBadge
                            }
                          >
                            {role.scope === 'custom'
                              ? 'Personalizado'
                              : 'Rol base'}
                          </span>
                        </div>
                        <p>
                          {role.description ||
                            'Sin descripción definida para este rol.'}
                        </p>
                      </div>

                      <button
                        className={styles.editButton}
                        type="button"
                        onClick={() => editRole(role)}
                      >
                        {role.scope === 'custom'
                          ? 'Editar'
                          : 'Usar como base'}
                      </button>
                    </div>

                    <div className={styles.meta}>
                      <span>
                        {role.permissions.length} permiso
                        {role.permissions.length === 1 ? '' : 's'}
                      </span>
                      <span>
                        {role.memberCount} usuario
                        {role.memberCount === 1 ? '' : 's'} asignado
                        {role.memberCount === 1 ? '' : 's'}
                      </span>
                    </div>

                    <div className={styles.chips}>
                      {role.permissions.map((permission) => (
                        <span key={permission.key}>{permission.name}</span>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
