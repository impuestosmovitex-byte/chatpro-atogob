create or replace function public.enforce_company_user_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed_users integer;
  current_active integer;
begin
  if coalesce(new.active, false) = false then
    return new;
  end if;

  select ce.max_users
    into allowed_users
  from public.company_entitlements ce
  where ce.company_id = new.company_id;

  -- Compatibilidad hacia atrás: empresas sin entitlements no tienen límite todavía.
  if allowed_users is null then
    return new;
  end if;

  select count(*)::integer
    into current_active
  from public.company_memberships cm
  where cm.company_id = new.company_id
    and cm.active = true
    and (tg_op = 'INSERT' or cm.id <> new.id);

  if current_active >= allowed_users then
    raise exception 'La empresa alcanzó el máximo de % usuarios activos de su plan.', allowed_users
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_company_membership_user_limit
  on public.company_memberships;

create trigger trg_company_membership_user_limit
before insert or update of active, company_id
on public.company_memberships
for each row
execute function public.enforce_company_user_limit();
