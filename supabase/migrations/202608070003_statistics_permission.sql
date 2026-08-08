insert into public.app_permissions (
  key,
  name,
  description
)
values (
  'statistics.view',
  'Ver estadísticas',
  'Permite consultar estadísticas, métricas operativas y reportes de la empresa.'
)
on conflict (key)
do update set
  name = excluded.name,
  description = excluded.description;
