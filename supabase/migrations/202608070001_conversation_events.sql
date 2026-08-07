create table if not exists public.conversation_events (
  id uuid primary key default gen_random_uuid(),

  company_id uuid not null,
  session_id uuid null,

  customer_phone text null,
  channel text not null default 'whatsapp',

  event_type text not null,
  event_source text not null default 'system',

  advisor_user_id uuid null,
  advisor_name text null,

  service_area_id uuid null,
  service_area_name text null,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

create index if not exists conversation_events_company_created_idx
  on public.conversation_events (
    company_id,
    created_at desc
  );

create index if not exists conversation_events_company_type_created_idx
  on public.conversation_events (
    company_id,
    event_type,
    created_at desc
  );

create index if not exists conversation_events_session_idx
  on public.conversation_events (
    session_id,
    created_at desc
  );

create index if not exists conversation_events_channel_idx
  on public.conversation_events (
    company_id,
    channel,
    created_at desc
  );

create index if not exists conversation_events_advisor_idx
  on public.conversation_events (
    company_id,
    advisor_user_id,
    created_at desc
  );

create index if not exists conversation_events_area_idx
  on public.conversation_events (
    company_id,
    service_area_id,
    created_at desc
  );

comment on table public.conversation_events is
  'Eventos analíticos y comerciales de Chat Pro para informes por empresa, conversación, canal, IA, asesor y área.';
