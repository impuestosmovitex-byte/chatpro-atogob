-- Staging-only minimal identity and permissions scaffolding.
-- No real users or customer data are imported.
create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from public, anon, authenticated;
grant all on public.platform_admins to service_role;

insert into public.app_roles(key,name,description,is_system,company_id)
values
 ('owner','Propietario','Acceso principal a la empresa',true,null),
 ('admin','Administrador','Administración interna del negocio',true,null),
 ('advisor','Asesor','Atención operativa según permisos',true,null)
on conflict do nothing;

insert into public.app_permissions(key,name,description)
values
 ('inbox.view','Ver bandeja','Consultar conversaciones de la empresa'),
 ('clients.view','Ver clientes','Consultar contactos'),
 ('statistics.view','Ver estadísticas','Consultar resultados'),
 ('native_orders.view','Ver pedidos','Consultar pedidos propios'),
 ('native_orders.manage','Gestionar pedidos','Cambiar estados operativos')
on conflict(key) do nothing;

insert into public.app_role_permissions(role_id,permission_id)
select r.id,p.id
from public.app_roles r cross join public.app_permissions p
where r.key in ('owner','admin') and r.company_id is null
on conflict do nothing;
