-- Permisos independientes para herramientas operativas de la bandeja.

insert into public.app_permissions (key, name, description)
values
  (
    'inbox.templates.send',
    'Usar plantillas de WhatsApp',
    'Puede consultar y enviar plantillas aprobadas de WhatsApp desde la bandeja.'
  ),
  (
    'inbox.quick_replies.use',
    'Usar respuestas rápidas',
    'Puede utilizar las respuestas rápidas configuradas por la empresa.'
  ),
  (
    'inbox.media.send',
    'Enviar imágenes y archivos',
    'Puede enviar imágenes y otros archivos permitidos desde la bandeja.'
  )
on conflict (key) do update
set
  name = excluded.name,
  description = excluded.description;

-- Conservamos el funcionamiento actual para los roles existentes:
-- los usuarios que ya podían responder reciben inicialmente estos permisos.
-- Después el propietario puede quitarlos individualmente desde el panel.

insert into public.app_role_permissions (role_id, permission_id)
select distinct role_row.id, target_permission.id
from public.app_roles role_row
cross join public.app_permissions target_permission
where target_permission.key in (
  'inbox.templates.send',
  'inbox.quick_replies.use',
  'inbox.media.send'
)
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
