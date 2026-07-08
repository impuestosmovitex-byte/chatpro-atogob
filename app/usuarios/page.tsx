'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { AppSidebar } from '../components/AppSidebar';
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
  permissions: Permission[];
};

type ServiceArea = { id: string; name: string; isActive: boolean; };

type CompanyUser = {
  id: string;
  membershipId: string;
  fullName: string;
  identifier: string;
  roleKey: string;
  roleName: string;
  active: boolean;
  areaIds: string[];
  areas: ServiceArea[];
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
  areas?: ServiceArea[];
};

const EMPTY_FORM = {
  fullName: '',
  identifier: '',
  password: '',
  roleKey: '',
  areaIds: [] as string[],
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
  const [areas, setAreas] = useState<ServiceArea[]>([]);
  const [users, setUsers] = useState<CompanyUser[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [workingUserId, setWorkingUserId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [resetUserId, setResetUserId] = useState('');
  const [resetPassword, setResetPassword] = useState('');

  const isFirstUser = users.length === 0;
  const availableRoles = useMemo(
    () => (isFirstUser ? roles.filter((role) => role.key === 'owner') : roles),
    [isFirstUser, roles],
  );
  const selectedRole = useMemo(
    () => roles.find((role) => role.key === form.roleKey) ?? null,
    [form.roleKey, roles],
  );

  async function load() {
    setLoading(true);
    setError('');

    try {
      const response = await fetch(
        `/api/users`,
        { cache: 'no-store' },
      );
      const data = (await response.json()) as ResponseData;

      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'No se pudieron cargar los usuarios.');
      }

      const nextUsers = data.users || [];
      const nextRoles = data.roles || [];
      const defaultRole =
        nextUsers.length === 0
          ? nextRoles.find((role) => role.key === 'owner')?.key || ''
          : nextRoles.find((role) => role.key === 'advisor')?.key ||
            nextRoles[0]?.key ||
            '';

      setCompanyName(data.company?.name || 'Empresa');
      setUsers(nextUsers);
      setRoles(nextRoles);
      setAreas(data.areas || []);
      setForm((current) => ({
        ...current,
        roleKey: nextRoles.some((role) => role.key === current.roleKey) &&
          (nextUsers.length > 0 || current.roleKey === 'owner')
          ? current.roleKey
          : defaultRole,
      }));
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

  function toggleArea(ids: string[], areaId: string): string[] {
    return ids.includes(areaId) ? ids.filter((id) => id !== areaId) : [...ids, areaId];
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setMessage('');
    setError('');

    try {
      const response = await fetch(
        `/api/users`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'create', ...form }),
        },
      );
      const data = (await response.json()) as ResponseData;

      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'No se pudo crear el usuario.');
      }

      setMessage(data.message || 'Usuario creado correctamente.');
      setForm(EMPTY_FORM);
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

  async function updateUser(userId: string, payload: Record<string, unknown>) {
    setWorkingUserId(userId);
    setMessage('');
    setError('');

    try {
      const response = await fetch(
        `/api/users`,
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
        `/api/users`,
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
      setResetUserId('');
      setResetPassword('');
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
            <p className={styles.eyebrow}>SEGURIDAD Y ACCESOS</p>
            <h1>Usuarios</h1>
            <p>Crea accesos con identificación o código para {companyName}.</p>
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
              <p>{isFirstUser ? 'Configuración inicial' : 'Nuevo acceso'}</p>
              <h2>
                {isFirstUser ? 'Crear propietario inicial' : 'Crear usuario'}
              </h2>
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
                  placeholder="Ejemplo: Yesid Vargas"
                  disabled={loading || creating}
                />
              </label>

              <label>
                <span>Identificación o código de acceso</span>
                <input
                  value={form.identifier}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      identifier: event.target.value,
                    }))
                  }
                  placeholder="Ejemplo: 1020304050"
                  autoCapitalize="characters"
                  disabled={loading || creating}
                />
                <small>
                  Puede ser una cédula o un código interno. No se usa correo
                  para iniciar sesión.
                </small>
              </label>

              <label>
                <span>Contraseña inicial</span>
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
                  disabled={loading || creating || isFirstUser}
                >
                  {availableRoles.map((role) => (
                    <option key={role.key} value={role.key}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </label>

              <fieldset className={styles.areaSelector}>
                <legend>Áreas de atención <small>Opcional</small></legend>
                <p>Solo los usuarios con un área podrán recibir chats automáticos.</p>
                <div className={styles.areaOptions}>
                  {areas.filter((area) => area.isActive).map((area) => (
                    <label key={area.id}>
                      <input type="checkbox" checked={form.areaIds.includes(area.id)} disabled={loading || creating}
                        onChange={() => setForm((current) => ({ ...current, areaIds: toggleArea(current.areaIds, area.id) }))} />
                      <span>{area.name}</span>
                    </label>
                  ))}
                  {!areas.filter((area) => area.isActive).length ? <small>No hay áreas activas. Crea una primero.</small> : null}
                </div>
              </fieldset>

              <button
                className={styles.createButton}
                type="submit"
                disabled={
                  loading ||
                  creating ||
                  !availableRoles.length ||
                  !form.roleKey
                }
              >
                {creating
                  ? 'Creando…'
                  : isFirstUser
                    ? 'Crear propietario'
                    : 'Crear usuario'}
              </button>
            </form>

            <div className={styles.rolePreview}>
              <strong>{selectedRole?.name || 'Selecciona un rol'}</strong>
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
                Crea el propietario inicial. Después cada persona entrará con
                su identificación o código y su contraseña.
              </div>
            ) : (
              <div className={styles.userList}>
                {users.map((user) => (
                  <article className={styles.userRow} key={user.id}>
                    <div className={styles.avatar}>
                      {user.fullName.slice(0, 1).toUpperCase()}
                    </div>

                    <div className={styles.userInfo}>
                      <strong>{user.fullName}</strong>
                      <span>Identificación: {user.identifier}</span>
                      <small>Último acceso: {formatDate(user.lastSignInAt)}</small>
                      <div className={styles.userAreas}>
                        {(user.areas ?? []).length ? (user.areas ?? []).map((area) => <span key={area.id}>{area.name}</span>) : <em>Sin área asignada · no recibe chats automáticos</em>}
                      </div>
                    </div>

                    <div className={styles.userControls}>
                      <label>
                        <span>Rol</span>
                        <select
                          value={user.roleKey}
                          disabled={workingUserId === user.id}
                          onChange={(event) =>
                            void updateUser(user.id, {
                              roleKey: event.target.value,
                            })
                          }
                        >
                          {roles.map((role) => (
                            <option key={role.key} value={role.key}>
                              {role.name}
                            </option>
                          ))}
                        </select>
                      </label>

                      <details className={styles.userAreaEditor}>
                        <summary>Áreas ({(user.areas ?? []).length})</summary>
                        <div className={styles.userAreaMenu}>
                          <p>Selecciona las áreas que puede atender esta persona.</p>
                          {areas.filter((area) => area.isActive).map((area) => (
                            <label key={area.id}>
                              <input type="checkbox" checked={(user.areaIds ?? []).includes(area.id)} disabled={workingUserId === user.id}
                                onChange={() => void updateUser(user.id, { areaIds: toggleArea(user.areaIds ?? [], area.id) })} />
                              <span>{area.name}</span>
                            </label>
                          ))}
                        </div>
                      </details>

                      <button
                        className={
                          user.active
                            ? styles.statusActive
                            : styles.statusInactive
                        }
                        type="button"
                        disabled={workingUserId === user.id}
                        onClick={() =>
                          void updateUser(user.id, { active: !user.active })
                        }
                      >
                        {user.active ? 'Activo' : 'Inactivo'}
                      </button>

                      <button
                        className={styles.passwordButton}
                        type="button"
                        disabled={workingUserId === user.id}
                        onClick={() => {
                          setResetUserId(user.id);
                          setResetPassword('');
                        }}
                      >
                        Cambiar clave
                      </button>
                    </div>

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
                          placeholder="Nueva contraseña, mínimo 8 caracteres"
                          required
                        />
                        <button
                          type="submit"
                          disabled={workingUserId === user.id || !resetPassword}
                        >
                          Guardar
                        </button>
                        <button
                          type="button"
                          disabled={workingUserId === user.id}
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
                ))}
              </div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
