-- Staging-only manual contract engine. DO NOT run in production.
-- All changes occur in one transaction; no external payment provider is contacted.
create table if not exists public.mw1_manual_company_contracts (
 company_id uuid primary key references public.companies(id) on delete restrict,
 tier text not null check(tier in ('basico','eco','pro')),
 payment_reference text not null unique,
 amount_cop bigint not null check(amount_cop>0),
 verified_at timestamptz not null,
 starts_at timestamptz not null,
 expires_at timestamptz not null check(expires_at>starts_at),
 included_users integer not null check(included_users>0),
 additional_users integer not null default 0 check(additional_users between 0 and 100),
 status text not null default 'active' check(status in ('active','expired')),
 activated_by uuid not null references auth.users(id),
 activated_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.mw1_manual_contract_history (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete restrict,
 action text not null check(action in ('activated','renewed')),
 actor_id uuid not null references auth.users(id),
 payment_reference text not null,
 old_value jsonb,
 new_value jsonb not null,
 recorded_at timestamptz not null default now()
);
create index if not exists mw1_manual_history_company_date_idx
 on public.mw1_manual_contract_history(company_id,recorded_at desc);
alter table public.mw1_manual_company_contracts enable row level security;
alter table public.mw1_manual_contract_history enable row level security;
revoke all on public.mw1_manual_company_contracts from public,anon,authenticated;
revoke all on public.mw1_manual_contract_history from public,anon,authenticated;
grant select,insert,update on public.mw1_manual_company_contracts to service_role;
grant select,insert on public.mw1_manual_contract_history to service_role;

create or replace function public.mw1_apply_manual_contract(
 p_company_id uuid,p_actor_id uuid,p_tier text,p_payment_reference text,
 p_amount_cop bigint,p_verified_at timestamptz,p_starts_at timestamptz,
 p_expires_at timestamptz,p_additional_users integer,p_reason text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_company record;
 v_approval record;
 v_draft record;
 v_assignment record;
 v_old jsonb;
 v_new jsonb;
 v_users integer;
 v_included integer;
 v_rights jsonb;
 v_current_active integer;
begin
 -- RPC callable only with privileged server credential. Reject ordinary sessions.
 if auth.role() is distinct from 'service_role' then
   raise exception 'Privileged server operation only';
 end if;
 if not exists(select 1 from public.platform_admins
               where user_id=p_actor_id and active=true) then
   raise exception 'Super Admin inactive or absent';
 end if;
 if p_tier not in ('basico','eco','pro') or
    p_payment_reference !~ '^[a-zA-Z0-9_./-]{6,100}$' or
    p_amount_cop<1 or p_amount_cop>999999999 or
    p_verified_at>now()+interval '1 minute' or
    p_starts_at is null or p_expires_at<=p_starts_at or
    p_expires_at>p_starts_at+interval '366 days' or
    p_additional_users not between 0 and 100 or
    length(trim(p_reason)) not between 8 and 500 then
   raise exception 'Invalid manual activation parameters';
 end if;
 select id,slug into v_company from public.companies
   where id=p_company_id for update;
 if not found then raise exception 'Company not found'; end if;
 -- Protect existing operational tenants and any clones in the directory.
 if v_company.slug in ('atogob','maogo','emprende-con-maogo') or
    exists(select 1 from public.platform_external_tenant_registry
           where company_slug=v_company.slug) then
   raise exception 'Operational tenant cannot be activated here';
 end if;
 select tier into v_assignment from public.mw1_company_plan_assignment_drafts
   where company_id=p_company_id;
 if not found or v_assignment.tier<>p_tier then
   raise exception 'The plan assignment draft does not match';
 end if;
 select tier,rights,draft_updated_at into v_approval
   from public.mw1_commercial_feature_approvals where tier=p_tier;
 select tier,updated_at into v_draft
   from public.mw1_commercial_feature_drafts where tier=p_tier;
 if v_approval.tier is null or v_approval.draft_updated_at is distinct from v_draft.updated_at then
   raise exception 'Commercial plan is not approved at its current revision';
 end if;
 if not exists (
   select 1 from public.mw1_plan_activation_audit
   where company_id=p_company_id and proposed_tier=p_tier
     and action='activation_review_approved'
 ) then raise exception 'Missing reviewed activation approval'; end if;
 v_rights:=v_approval.rights;
 if jsonb_typeof(v_rights)<>'object' or
   exists(select 1 from unnest(array['ai_assistant','whatsapp','instagram','messenger',
     'automations','catalog_pdf','native_orders','merchant_payments','statistics']) as f(k)
     where v_rights->>f.k not in ('included','not_included')
        or v_rights->>f.k is null) then
   raise exception 'Feature matrix incomplete';
 end if;
 v_included:=case p_tier when 'basico' then 2 else 3 end;
 v_users:=v_included+p_additional_users;
 select count(*) into v_current_active from public.company_memberships
  where company_id=p_company_id and active=true;
 if v_current_active>v_users then
   raise exception 'Existing active members exceed purchased seats';
 end if;
 select to_jsonb(c) into v_old from public.mw1_manual_company_contracts c
  where company_id=p_company_id for update;
 -- Enforce no duplicate payment evidence, including repeated requests.
 if exists(select 1 from public.mw1_manual_contract_history
           where payment_reference=p_payment_reference) then
   raise exception 'This payment evidence was already used';
 end if;
 insert into public.company_entitlements(
  company_id,plan_key,ai_enabled,whatsapp_enabled,instagram_enabled,
  messenger_enabled,automations_enabled,statistics_enabled,max_users,max_whatsapp_lines,
  updated_at
 ) values(
  p_company_id,case p_tier when 'basico' then 'inicial' when 'eco' then 'pro' else 'empresa' end,
  v_rights->>'ai_assistant'='included',v_rights->>'whatsapp'='included',
  v_rights->>'instagram'='included',v_rights->>'messenger'='included',
  v_rights->>'automations'='included',v_rights->>'statistics'='included',
  v_users,1,now()
 ) on conflict(company_id) do update set
  plan_key=excluded.plan_key,ai_enabled=excluded.ai_enabled,
  whatsapp_enabled=excluded.whatsapp_enabled,instagram_enabled=excluded.instagram_enabled,
  messenger_enabled=excluded.messenger_enabled,
  automations_enabled=excluded.automations_enabled,
  statistics_enabled=excluded.statistics_enabled,max_users=excluded.max_users,
  max_whatsapp_lines=excluded.max_whatsapp_lines,updated_at=now();
 insert into public.mw1_manual_company_contracts(
  company_id,tier,payment_reference,amount_cop,verified_at,starts_at,expires_at,
  included_users,additional_users,status,activated_by
 ) values (
  p_company_id,p_tier,p_payment_reference,p_amount_cop,p_verified_at,p_starts_at,
  p_expires_at,v_included,p_additional_users,'active',p_actor_id
 ) on conflict(company_id) do update set
  tier=excluded.tier,payment_reference=excluded.payment_reference,
  amount_cop=excluded.amount_cop,verified_at=excluded.verified_at,
  starts_at=excluded.starts_at,expires_at=excluded.expires_at,
  included_users=excluded.included_users,additional_users=excluded.additional_users,
  status='active',activated_by=excluded.activated_by,updated_at=now();
 select to_jsonb(c) into v_new from public.mw1_manual_company_contracts c
  where company_id=p_company_id;
 insert into public.mw1_manual_contract_history(
  company_id,action,actor_id,payment_reference,old_value,new_value
 ) values(
  p_company_id,case when v_old is null then 'activated' else 'renewed' end,
  p_actor_id,p_payment_reference,v_old,v_new||jsonb_build_object('reason',p_reason)
 );
 insert into public.mw1_plan_activation_audit(
  company_id,proposed_tier,action,actor_id,details
 ) values(
  p_company_id,p_tier,'manual_contract_applied',p_actor_id,
  jsonb_build_object('paymentReference',p_payment_reference,
    'expiresAt',p_expires_at,'maxUsers',v_users)
 );
 return jsonb_build_object('ok',true,'companyId',p_company_id,
   'tier',p_tier,'maxUsers',v_users,'expiresAt',p_expires_at);
end;
$$;
revoke all on function public.mw1_apply_manual_contract(
 uuid,uuid,text,text,bigint,timestamptz,timestamptz,timestamptz,integer,text
) from public,anon,authenticated;
grant execute on function public.mw1_apply_manual_contract(
 uuid,uuid,text,text,bigint,timestamptz,timestamptz,timestamptz,integer,text
) to service_role;
