begin;

alter table public.service_areas
  add column if not exists area_type text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'service_areas_area_type_check'
  ) then
    alter table public.service_areas
      add constraint service_areas_area_type_check
      check (area_type in ('sales', 'service'));
  end if;
end
$$;

comment on column public.service_areas.area_type is
  'Tipo operativo configurable por empresa: sales o service. NULL conserva temporalmente compatibilidad con áreas antiguas.';

commit;
