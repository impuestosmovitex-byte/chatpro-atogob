-- STAGING ONLY: fix exact millisecond-to-microsecond normalization for review signatures.
-- The signed Super Admin review records ISO timestamps at six fractional digits
-- (e.g. 2026-11-15T04:17:16.824000). PostgreSQL to_char(...MS) emits
-- three; append zeros rather than weakening revision matching.
-- Replaces only our manual contract RPC; does not change tables or old audit records.
create or replace function public.mw1_apply_manual_contract(
 p_company_id uuid,p_actor_id uuid,p_tier text,p_payment_reference text,
 p_amount_cop bigint,p_verified_at timestamptz,p_starts_at timestamptz,
 p_expires_at timestamptz,p_additional_users integer,p_reason text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
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
 v_review record;
 v_existing_entitlements public.company_entitlements%ROWTYPE;
begin
 -- RPC callable only with privileged server credential. Reject ordinary sessions.
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
   raise exception 'Privileged server operation only';
 end if;
 if p_actor_id is null or not exists(select 1 from public.platform_admins pa
               join public.app_profiles ap on ap.user_id=pa.user_id
               join auth.users au on au.id=pa.user_id
               where pa.user_id=p_actor_id and pa.active=true and ap.active=true
               and au.deleted_at is null) then
   raise exception 'Super Admin inactive or absent';
 end if;
 if p_tier not in ('basico','eco','pro') or
    p_payment_reference !~ '^[a-zA-Z0-9_./-]{6,100}$' or
    p_amount_cop<1 or p_amount_cop>999999999 or
    p_verified_at is null or p_verified_at>now()+interval '1 minute' or
    p_starts_at is null or p_expires_at is null or p_expires_at<=p_starts_at or
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
 select tier,updated_at into v_assignment from public.mw1_company_plan_assignment_drafts
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
 -- Review must be the most recent decision for this exact company and
 -- must bind to the approved feature revision AND assignment revision.
 select action,proposed_tier,details into v_review
 from public.mw1_plan_activation_audit
 where company_id=p_company_id
 order by created_at desc,id desc limit 1;
 if v_review.action is distinct from 'activation_review_approved'
    or v_review.proposed_tier is distinct from p_tier
    or v_review.details->>'assignmentUpdatedAt' is distinct from
         (to_char(v_assignment.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS') || '000')
    or v_review.details->>'draftUpdatedAt' is distinct from
         (to_char(v_draft.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS') || '000')
 then
   raise exception 'Company-specific plan review is missing, stale or superseded';
 end if;
 v_rights:=v_approval.rights;
 if jsonb_typeof(v_rights)<>'object' or
   exists(select 1 from unnest(array['ai_assistant','whatsapp','instagram','messenger',
     'automations','catalog_pdf','native_orders','merchant_payments','statistics']) as f(k)
     where v_rights->>f.k not in ('included','not_included')
        or v_rights->>f.k is null) then
   raise exception 'Feature matrix incomplete';
 end if;
 -- The rights not mapped to company_entitlements cannot silently become active.
 if v_rights->>'catalog_pdf'='included' or
    v_rights->>'merchant_payments'='included' then
   raise exception 'Unsupported feature rights cannot be granted automatically';
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
 select * into v_existing_entitlements from public.company_entitlements
  where company_id=p_company_id for update;
 if v_existing_entitlements.max_users > v_users then
   raise exception 'Activation cannot silently reduce existing seat capacity';
 end if;
 if v_old is not null then
   if v_old->>'tier'<>p_tier then
     raise exception 'Plan switches require a separate reviewed migration process';
   end if;
   if p_additional_users < (v_old->>'additional_users')::integer or
      v_users < coalesce(v_existing_entitlements.max_users,0) then
     raise exception 'Renewal cannot silently reduce previously purchased seats';
   end if;
   if p_expires_at <= (v_old->>'expires_at')::timestamptz then
     raise exception 'Renewal must extend the contract expiry';
   end if;
   if v_existing_entitlements.plan_key is distinct from
         (case p_tier when 'basico' then 'inicial' when 'eco' then 'pro' else 'empresa' end)
      or v_existing_entitlements.ai_enabled is distinct from
         (v_rights->>'ai_assistant'='included')
      or v_existing_entitlements.whatsapp_enabled is distinct from
         (v_rights->>'whatsapp'='included')
      or v_existing_entitlements.instagram_enabled is distinct from
         (v_rights->>'instagram'='included')
      or v_existing_entitlements.messenger_enabled is distinct from
         (v_rights->>'messenger'='included')
      or v_existing_entitlements.automations_enabled is distinct from
         (v_rights->>'automations'='included')
      or v_existing_entitlements.statistics_enabled is distinct from
         (v_rights->>'statistics'='included')
      or v_existing_entitlements.native_orders_enabled is distinct from
         (v_rights->>'native_orders'='included') then
     raise exception 'Entitlements drift: renewal must not change feature capabilities';
   end if;
 end if;
 -- Enforce no duplicate payment evidence, including repeated requests.
 if exists(select 1 from public.mw1_manual_contract_history
           where payment_reference=p_payment_reference) then
   raise exception 'This payment evidence was already used';
 end if;
 insert into public.company_entitlements(
  company_id,plan_key,ai_enabled,whatsapp_enabled,instagram_enabled,
  messenger_enabled,automations_enabled,statistics_enabled,native_orders_enabled,max_users,max_whatsapp_lines,
  updated_at
 ) values(
  p_company_id,case p_tier when 'basico' then 'inicial' when 'eco' then 'pro' else 'empresa' end,
  v_rights->>'ai_assistant'='included',v_rights->>'whatsapp'='included',
  v_rights->>'instagram'='included',v_rights->>'messenger'='included',
  v_rights->>'automations'='included',v_rights->>'statistics'='included',
  v_rights->>'native_orders'='included',v_users,
  coalesce(v_existing_entitlements.max_whatsapp_lines,1),now()
 ) on conflict(company_id) do update set
  plan_key=excluded.plan_key,ai_enabled=excluded.ai_enabled,
  whatsapp_enabled=excluded.whatsapp_enabled,instagram_enabled=excluded.instagram_enabled,
  messenger_enabled=excluded.messenger_enabled,
  automations_enabled=excluded.automations_enabled,
  statistics_enabled=excluded.statistics_enabled,
  native_orders_enabled=excluded.native_orders_enabled,max_users=excluded.max_users,
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
 return jsonb_build_object('ok',true,'companyId',p_company_id,
   'tier',p_tier,'maxUsers',v_users,'expiresAt',p_expires_at);
end;
$$;
