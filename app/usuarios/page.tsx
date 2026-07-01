 'use client';

import { AppSidebar } from '../components/AppSidebar';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import styles from './page.module.css';

const COMPANY = process.env.NEXT_PUBLIC_CHATPRO_COMPANY || 'atogob';

type Permission = {
  key: string;
  name: string;
  description: string;
};

type Role = {
  key: string;
  name: string;
  description: string;
  permissions: Permission[];
};

type CompanyUser = {
  id: string;
  membershipId: string;
  fullName: string;
  email: string;
  roleKey: string;
  roleName: string;
  active: boolean;
  createdAt: string;
  lastSignInAt: string | null;
};

type ResponseData = {
  ok?: boolean;
  error?: string;
  message?: string;
  company?: { name?: string; slug?: string };
  roles?: Role[];
  users?: CompanyUser[];
};

const EMPTY_FORM = {
  fullName: '',
  email: '',
  password: '',
  roleKey: 'advisor',
};

function formatDate(value: string | null): string {
  if (!value) {
    return 'Aún no ha ingresado';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Sin fecha';
  }

  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export default function UsuariosPage() {
  const [companyName, setCompanyName] = useState('Empresa');
  const [roles, setRoles] = useState<Role[]>([]);
  const [users, setUsers] = useState<CompanyUser[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [workingUserId, setWorkingUserId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [resetUserId, setResetUserId] = useState('');
  const [resetPassword, setResetPassword] = useState('');

  const selectedRole = useMemo(
    () => roles.find((role) => role.key === form.roleKey) ?? null,
    [form.roleKey, roles],
  );

  async function load() {
    setLoading(true);
    setError('');

    try {
      const response = await fetch(
        `/api/users?company=${encodeURIComponent(COMPANY)}`,
        { cache: 'no-store' },
      );
      const data = (await response.json()) as ResponseData;

      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'No se pudieron cargar los usuarios.');
      }

      setCompanyName(data.company?.name || 'Empresa');
      setRoles(data.roles || []);
      setUsers(data.users || []);

      if (
        data.roles?.length &&
        !data.roles.some((role) => role.key === form.roleKey)
      ) {
        setForm((current) => ({
          ...current,
          roleKey: data.roles?.find((role) => role.key === 'advisor')?.key ||
            data.roles?.[0]?.key ||
            '',
        }));
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'No se pudieron cargar los usuarios.',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setMessage('');
    setError('');

    try {
      const response = await fetch(
        `/api/users?company=${encodeURIComponent(COMPANY)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'create',
            ...form,
          }),
        },
      );
      const data = (await response.json()) as ResponseData;

      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'No se pudo crear el usuario.');
      }

      setMessage(data.message || 'Usuario creado correctamente.');
      setForm((current) => ({
        ...EMPTY_FORM,
        roleKey: current.roleKey,
      }));
      await load();
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : 'No se pudo crear el usuario.',
      );
    } finally {
      setCreating(false);
    }
  }

  async function updateUser(
    userId: string,
    payload: Record<string, unknown>,
  ) {
    setWorkingUserId(userId);
    setMessage('');
    setError('');

    try {
      const response = await fetch(
        `/api/users?company=${encodeURIComponent(COMPANY)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ userId, ...payload }),
        },
      );
      const data = (await response.json()) as ResponseData;

      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'No se pudo actualizar el usuario.');
      }

      setMessage(data.message || 'Usuario actualizado correctamente.');
      await load();
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : 'No se pudo actualizar el usuario.',
      );
    } finally {
      setWorkingUserId('');
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!resetUserId) {
      return;
    }

    setWorkingUserId(resetUserId);
    setMessage('');
    setError('');

    try {
      const response = await fetch(
        `/api/users?company=${encodeURIComponent(COMPANY)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'reset-password',
            userId: resetUserId,
            password: resetPassword,
          }),
        },
      );
      const data = (await response.json()) as ResponseData;

      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'No se pudo cambiar la contraseña.');
      }

      setMessage(data.message || 'Contraseña actualizada correctamente.');
      setResetPassword('');
      setResetUserId('');
    } catch (passwordError) {
      setError(
        passwordError instanceof Error
          ? passwordError.message
          : 'No se pudo cambiar la contraseña.',
      );
    } finally {
      setWorkingUserId('');
    }
  }

  return (
    <main className={styles.shell}>
      <AppSidebar companyName={companyName} />

      <section className={styles.workspace}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>EQUIPO Y ACCESOS</p>
            <h1>Usuarios</h1>
            <p>
              Crea y administra las cuentas que pueden operar {companyName}.
            </p>
          </div>
          <div className={styles.headerActions}>
            <button
              className={styles.rolesButton}
              type="button"
              onClick={() => window.location.assign('/usuarios/roles')}
            >
              Roles y permisos
            </button>
            <button
              className={styles.refresh}
              type="button"
              onClick={() => void load()}
              disabled={loading}
            >
              ↻ Actualizar
            </button>
          </div>
        </header>

        {error ? <div className={styles.error}>{error}</div> : null}
        {message ? <div className={styles.success}>{message}</div> : null}

        <div className={styles.grid}>
          <section className={styles.createCard}>
            <div className={styles.sectionHeading}>
              <p>Nuevo acceso</p>
              <h2>Crear usuario</h2>
            </div>

            <form onSubmit={createUser} className={styles.form}>
              <label>
                <span>Nombre completo</span>
                <input
                  value={form.fullName}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      fullName: event.target.value,
                    }))
                  }
                  placeholder="Ejemplo: Valentina Gómez"
                  disabled={loading || creating}
                />
              </label>

              <label>
                <span>Correo</span>
                <input
                  type="email"
                  value={form.email}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                  placeholder="asesora@empresa.com"
                  disabled={loading || creating}
                />
              </label>

              <label>
                <span>Contraseña temporal</span>
                <input
                  type="password"
                  minLength={8}
                  value={form.password}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      password: event.target.value,
                    }))
                  }
                  placeholder="Mínimo 8 caracteres"
                  disabled={loading || creating}
                />
              </label>

              <label>
                <span>Rol</span>
                <select
                  value={form.roleKey}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      roleKey: event.target.value,
                    }))
                  }
                  disabled={loading || creating}
                >
                  {roles.map((role) => (
                    <option key={role.key} value={role.key}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </label>

              <button
                className={styles.createButton}
                type="submit"
                disabled={loading || creating || !roles.length}
              >
                {creating ? 'Creando…' : 'Crear usuario'}
              </button>
            </form>

            <div className={styles.rolePreview}>
              <strong>
                {selectedRole?.name || 'Selecciona un rol'}
              </strong>
              <p>{selectedRole?.description || 'Define el nivel de acceso.'}</p>
              <div className={styles.permissionList}>
                {(selectedRole?.permissions || []).map((permission) => (
                  <span key={permission.key}>{permission.name}</span>
                ))}
              </div>
            </div>
          </section>

          <section className={styles.usersCard}>
            <div className={styles.sectionHeading}>
              <p>Equipo actual</p>
              <h2>
                {loading ? 'Cargando usuarios…' : `${users.length} usuarios`}
              </h2>
            </div>

            {loading ? (
              <div className={styles.empty}>Cargando accesos…</div>
            ) : users.length === 0 ? (
              <div className={styles.empty}>
                Aún no hay usuarios. Crea el primer propietario o asesor de{' '}
                {companyName}.
              </div>
            ) : (
              <div className={styles.userList}>
                {users.map((user) => {
                  const role = roles.find(
                    (item) => item.key === user.roleKey,
                  );
                  const working = workingUserId === user.id;

                  return (
                    <article className={styles.userRow} key={user.id}>
                      <div className={styles.avatar}>
                        {user.fullName.trim().slice(0, 1).toUpperCase() || 'U'}
                      </div>

                      <div className={styles.userInfo}>
                        <strong>{user.fullName}</strong>
                        <span>{user.email}</span>
                        <small>
                          Último ingreso: {formatDate(user.lastSignInAt)}
                        </small>
                      </div>

                      <div className={styles.userControls}>
                        <label>
                          <span>Rol</span>
                          <select
                            value={user.roleKey}
                            disabled={working}
                            onChange={(event) =>
                              void updateUser(user.id, {
                                roleKey: event.target.value,
                              })
                            }
                          >
                            {roles.map((item) => (
                              <option key={item.key} value={item.key}>
                                {item.name}
                              </option>
                            ))}
                          </select>
                        </label>

                        <button
                          className={
                            user.active
                              ? styles.statusActive
                              : styles.statusInactive
                          }
                          type="button"
                          disabled={working}
                          onClick={() =>
                            void updateUser(user.id, {
                              active: !user.active,
                            })
                          }
                        >
                          {user.active ? 'Activo' : 'Inactivo'}
                        </button>

                        <button
                          className={styles.passwordButton}
                          type="button"
                          disabled={working}
                          onClick={() => {
                            setResetUserId(user.id);
                            setResetPassword('');
                          }}
                        >
                          Restablecer clave
                        </button>
                      </div>

                      {role ? (
                        <div className={styles.rowPermissions}>
                          {role.permissions.length} permisos por rol
                        </div>
                      ) : null}

                      {resetUserId === user.id ? (
                        <form
                          className={styles.resetBox}
                          onSubmit={changePassword}
                        >
                          <input
                            type="password"
                            minLength={8}
                            value={resetPassword}
                            onChange={(event) =>
                              setResetPassword(event.target.value)
                            }
                            placeholder="Nueva contraseña temporal"
                            autoFocus
                          />
                          <button type="submit" disabled={working}>
                            Guardar
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setResetUserId('');
                              setResetPassword('');
                            }}
                          >
                            Cancelar
                          </button>
                        </form>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
