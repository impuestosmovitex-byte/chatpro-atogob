-- Permisos operativos de ChatPro.
-- Permite abrir la tienda, iniciar conversaciones y habilitar audios por rol.

insert into public.app_permissions (key, name, description)
values
  (
    'storefront.open',
    'Abrir tienda como visitante',
    'Puede abrir la tienda pública conectada para copiar y enviar enlaces.'
  ),
  (
    'inbox.start',
    'Iniciar conversaciones',
    'Puede tomar e iniciar conversaciones disponibles desde la base de clientes.'
  ),
  (
    'inbox.audio',
    'Enviar audios',
    'Puede grabar y enviar notas de voz desde la bandeja.'
  )
on conflict (key) do update
set
  name = excluded.name,
  description = excluded.description;

-- Abrir tienda: propietarios, administradores y roles que ya consultan
-- clientes o la bandeja.
insert into public.app_role_permissions (role_id, permission_id)
select distinct role_row.id, target_permission.id
from public.app_roles role_row
cross join public.app_permissions target_permission
where target_permission.key = 'storefront.open'
  and (
    lower(role_row.key) in ('owner', 'admin')
    or exists (
      select 1
      from public.app_role_permissions current_link
      join public.app_permissions current_permission
        on current_permission.id = current_link.permission_id
      where current_link.role_id = role_row.id
        and current_permission.key in ('clients.view', 'inbox.view')
    )
  )
on conflict do nothing;

-- Iniciar conversación: propietarios, administradores y roles que ya
-- pueden responder la bandeja y consultar clientes.
insert into public.app_role_permissions (role_id, permission_id)
select distinct role_row.id, target_permission.id
from public.app_roles role_row
cross join public.app_permissions target_permission
where target_permission.key = 'inbox.start'
  and (
    lower(role_row.key) in ('owner', 'admin')
    or (
      exists (
        select 1
        from public.app_role_permissions reply_link
        join public.app_permissions reply_permission
          on reply_permission.id = reply_link.permission_id
        where reply_link.role_id = role_row.id
          and reply_permission.key = 'inbox.reply'
      )
      and exists (
        select 1
        from public.app_role_permissions client_link
        join public.app_permissions client_permission
          on client_permission.id = client_link.permission_id
        where client_link.role_id = role_row.id
          and client_permission.key = 'clients.view'
      )
    )
  )
on conflict do nothing;

-- Audios: queda visible desde ahora en el editor de roles. La función
-- de grabación se conecta en el bloque específico de audios.
insert into public.app_role_permissions (role_id, permission_id)
select distinct role_row.id, target_permission.id
from public.app_roles role_row
cross join public.app_permissions target_permission
where target_permission.key = 'inbox.audio'
  and (
    lower(role_row.key) in ('owner', 'admin')
    or exists (
      select 1
      from public.app_role_permissions reply_link
      join public.app_permissions reply_permission
        on reply_permission.id = reply_link.permission_id
      where reply_link.role_id = role_row.id
        and reply_permission.key = 'inbox.reply'
    )
  )
on conflict do nothing;
