begin;

alter table public.company_support_settings
  add column if not exists advisors_can_take_ai boolean;

alter table public.company_support_settings
  add column if not exists ai_take_after_minutes integer;

update public.company_support_settings
set
  advisors_can_take_ai = coalesce(advisors_can_take_ai, false),
  ai_take_after_minutes = coalesce(ai_take_after_minutes, 60)
where
  advisors_can_take_ai is null
  or ai_take_after_minutes is null;

alter table public.company_support_settings
  alter column advisors_can_take_ai set default false,
  alter column advisors_can_take_ai set not null,
  alter column ai_take_after_minutes set default 60,
  alter column ai_take_after_minutes set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'company_support_settings_ai_take_minutes_check'
  ) then
    alter table public.company_support_settings
      add constraint company_support_settings_ai_take_minutes_check
      check (ai_take_after_minutes between 1 and 10080);
  end if;
end
$$;

commit;
