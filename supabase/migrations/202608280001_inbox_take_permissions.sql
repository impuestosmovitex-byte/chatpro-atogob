-- Permisos independientes para tomar conversaciones desde la bandeja.
--
-- El permiso histórico inbox.take NO se elimina y conserva su comportamiento
-- anterior mediante compatibilidad en la aplicación.
--
-- Los nuevos permisos permiten configurar explícitamente qué tipo de
-- conversaciones puede tomar cada rol.

insert into public.app_permissions (key, name, description)
values
  (
    'inbox.take_ai',
    'Tomar conversaciones de IA',
    'Puede tomar conversaciones que actualmente están siendo atendidas por la IA.'
  ),
  (
    'inbox.take_waiting',
    'Tomar conversaciones pendientes',
    'Puede tomar conversaciones que están esperando atención humana.'
  ),
  (
    'inbox.take_all',
    'Tomar todas las conversaciones',
    'Puede tomar conversaciones de IA, pendientes y conversaciones asignadas a otros asesores.'
  )
on conflict (key) do update
set
  name = excluded.name,
  description = excluded.description;

-- El permiso más amplio se entrega inicialmente únicamente a roles base
-- de propietario y administrador.
--
-- Los demás roles conservan sus permisos actuales sin ampliación automática
-- y podrán configurarse posteriormente desde el editor de roles.

insert into public.app_role_permissions (role_id, permission_id)
select distinct
  role_row.id,
  target_permission.id
from public.app_roles role_row
cross join public.app_permissions target_permission
where target_permission.key = 'inbox.take_all'
  and lower(role_row.key) in ('owner', 'admin')
on conflict do nothing;
