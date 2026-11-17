-- REVIEW-ONLY MIGRATION. DO NOT APPLY TO PRODUCTION OR STAGING WITHOUT APPROVAL.
-- Server-only, persistent one-time reservation for recovery of a social AI reply
-- lost during an upstream outage. This migration is included for review only.
-- It NEVER sends, generates, modifies, or replays customer messages.

create table if not exists public.mw1_social_ai_recovery_attempts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  session_id uuid not null references public.social_conversation_sessions(id),
  inbound_message_id bigint not null references public.social_conversations(id),
  channel text not null check (channel in ('instagram','messenger')),
  outage_cutoff timestamptz not null,
  state text not null default 'reserved'
    check (state in ('reserved','sending','submitted','suppressed','cancelled','needs_review')),
  provider_message_id text,
  failure_code text,
  created_at timestamptz not null default now(),
  send_started_at timestamptz,
  finalized_at timestamptz,
  -- One recovery for the *whole session*, not merely one incoming message.
  -- A timeout or uncertain Meta result must never be automatically replayed.
  constraint mw1_social_ai_recovery_session_once unique (company_id,session_id)
);
create index if not exists mw1_social_ai_recovery_company_created
  on public.mw1_social_ai_recovery_attempts(company_id,created_at desc);

alter table public.mw1_social_ai_recovery_attempts enable row level security;
revoke all on table public.mw1_social_ai_recovery_attempts from public,anon,authenticated;
grant select,insert,update on table public.mw1_social_ai_recovery_attempts to service_role;

create or replace function public.mw1_reserve_social_ai_recovery(
  p_company_id uuid,
  p_session_id uuid,
  p_last_inbound_id bigint,
  p_cutoff timestamptz
) returns uuid
language plpgsql
security invoker
set search_path = pg_catalog,pg_temp
as $$
declare
  v_session record;
  v_last record;
  v_id uuid;
begin
  if p_company_id is null or p_session_id is null or
     p_last_inbound_id is null or p_cutoff is null or
     p_cutoff > now() or p_cutoff < now()-interval '24 hours' then
    return null;
  end if;

  -- Serialize concurrent recovery workers on this session.
  select id,company_id,channel,attention_status,assigned_to_user_id
    into v_session
    from public.social_conversation_sessions
    where id=p_session_id and company_id=p_company_id
    for update;
  if not found or v_session.channel not in ('instagram','messenger') or
     v_session.attention_status <> 'ai' or
     v_session.assigned_to_user_id is not null then
    return null;
  end if;

  select id,company_id,session_id,channel,author_type,message_type,message,created_at
    into v_last
    from public.social_conversations
    where company_id=p_company_id and session_id=p_session_id
    order by created_at desc,id desc limit 1;
  if not found or v_last.id <> p_last_inbound_id or
     v_last.author_type <> 'customer' or
     v_last.channel <> v_session.channel or
     v_last.message_type not in ('text','postback') or
     nullif(trim(v_last.message),'') is null or
     v_last.created_at < p_cutoff or v_last.created_at > now() or
     v_last.created_at <= now()-interval '23 hours' then
    return null;
  end if;

  -- All affected customer events must be text/postback. Media requires a
  -- dedicated multimodal recovery; never fabricate an answer to a photo/audio.
  if exists (
    select 1 from public.social_conversations m
    where m.company_id=p_company_id and m.session_id=p_session_id
      and m.created_at>=p_cutoff and m.author_type='customer'
      and (m.message_type not in ('text','postback') or nullif(trim(m.message),'') is null)
  ) then return null; end if;

  if exists (
    select 1 from public.social_conversations m
    where m.company_id=p_company_id and m.session_id=p_session_id
      and m.created_at>=p_cutoff and m.author_type in ('advisor','assistant')
  ) then return null; end if;

  -- Explicitly reject tenants without configured instructions or active
  -- channel. The actual AI reply later reloads full company settings.
  if not exists (
    select 1 from public.company_settings cs
    where cs.company_id=p_company_id and nullif(trim(cs.ai_instructions),'') is not null
  ) or not exists (
    select 1 from public.company_integrations ci
    where ci.company_id=p_company_id and ci.provider='meta'
      and ci.integration_type=v_session.channel and ci.status='active'
  ) then return null; end if;

  insert into public.mw1_social_ai_recovery_attempts
    (company_id,session_id,inbound_message_id,channel,outage_cutoff)
  values (p_company_id,p_session_id,p_last_inbound_id,v_session.channel,p_cutoff)
  on conflict (company_id,session_id) do nothing
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.mw1_begin_social_ai_recovery_send(
  p_attempt_id uuid
) returns boolean
language plpgsql
security invoker
set search_path = pg_catalog,pg_temp
as $$
declare
  v_attempt record;
  v_session record;
  v_last record;
begin
  select * into v_attempt from public.mw1_social_ai_recovery_attempts
    where id=p_attempt_id for update;
  if not found or v_attempt.state<>'reserved' then return false; end if;

  select id,attention_status,assigned_to_user_id,channel
    into v_session from public.social_conversation_sessions
    where id=v_attempt.session_id and company_id=v_attempt.company_id for update;
  if not found or v_session.attention_status<>'ai'
    or v_session.assigned_to_user_id is not null
    or v_session.channel<>v_attempt.channel then return false; end if;

  select id,author_type,created_at,message_type
    into v_last from public.social_conversations
    where company_id=v_attempt.company_id and session_id=v_attempt.session_id
    order by created_at desc,id desc limit 1;
  if not found or v_last.id<>v_attempt.inbound_message_id
    or v_last.author_type<>'customer'
    or v_last.message_type not in ('text','postback')
    or v_last.created_at<=now()-interval '23 hours'
    or v_last.created_at>now() then return false; end if;

  if exists (
    select 1 from public.social_conversations
    where company_id=v_attempt.company_id and session_id=v_attempt.session_id
      and created_at>=v_attempt.outage_cutoff
      and author_type in ('advisor','assistant')
  ) then return false; end if;

  update public.mw1_social_ai_recovery_attempts
    set state='sending',send_started_at=clock_timestamp()
    where id=v_attempt.id;
  return true;
end $$;

create or replace function public.mw1_finish_social_ai_recovery(
  p_attempt_id uuid,
  p_state text,
  p_provider_message_id text default null,
  p_failure_code text default null
) returns boolean
language plpgsql
security invoker
set search_path = pg_catalog,pg_temp
as $$
declare
 v_old text;
begin
  if p_state not in ('submitted','suppressed','cancelled','needs_review')
    then return false; end if;
  select state into v_old from public.mw1_social_ai_recovery_attempts
    where id=p_attempt_id for update;
  if not found or v_old not in ('reserved','sending') then return false; end if;
  if p_state='submitted' and v_old<>'sending' then return false; end if;
  if p_state in ('suppressed','cancelled') and v_old<>'reserved'
    then return false; end if;
  update public.mw1_social_ai_recovery_attempts
    set state=p_state,
        provider_message_id=left(nullif(p_provider_message_id,''),200),
        failure_code=left(nullif(p_failure_code,''),120),
        finalized_at=clock_timestamp()
    where id=p_attempt_id;
  return true;
end $$;

revoke all on function public.mw1_reserve_social_ai_recovery(uuid,uuid,bigint,timestamptz)
  from public,anon,authenticated;
revoke all on function public.mw1_begin_social_ai_recovery_send(uuid)
  from public,anon,authenticated;
revoke all on function public.mw1_finish_social_ai_recovery(uuid,text,text,text)
  from public,anon,authenticated;
grant execute on function public.mw1_reserve_social_ai_recovery(uuid,uuid,bigint,timestamptz) to service_role;
grant execute on function public.mw1_begin_social_ai_recovery_send(uuid) to service_role;
grant execute on function public.mw1_finish_social_ai_recovery(uuid,text,text,text) to service_role;

-- No grants to authenticated or anon, no cron job, no triggers, no customer writes.
