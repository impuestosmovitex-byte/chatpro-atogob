begin;

create extension if not exists pgcrypto;

create table if not exists public.company_automations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  automation_key text not null,
  name text not null,
  description text not null default '',
  enabled boolean not null default false,
  timezone text not null default 'America/Bogota',
  allowed_days smallint[] not null default array[0,1,2,3,4,5,6]::smallint[],
  send_window_start time not null default '08:00',
  send_window_end time not null default '20:00',
  max_attempts integer not null default 3,
  retry_delay_minutes integer not null default 15,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_automations_company_key_unique
    unique (company_id, automation_key),
  constraint company_automations_attempts_check
    check (max_attempts between 1 and 10),
  constraint company_automations_retry_check
    check (retry_delay_minutes between 1 and 1440)
);

create table if not exists public.automation_executions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  automation_id uuid references public.company_automations(id) on delete set null,
  automation_key text not null,
  event_key text not null,
  channel text not null default 'whatsapp',
  recipient text,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  scheduled_for timestamptz not null default now(),
  next_retry_at timestamptz,
  locked_at timestamptz,
  locked_by text,
  sent_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  provider_message_id text,
  error_message text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_executions_event_unique
    unique (company_id, automation_key, event_key),
  constraint automation_executions_status_check
    check (status in ('pending','running','sent','failed','cancelled','skipped')),
  constraint automation_executions_attempt_check
    check (attempt_count >= 0)
);

create index if not exists automation_executions_company_created_idx
  on public.automation_executions (company_id, created_at desc);

create index if not exists automation_executions_retry_idx
  on public.automation_executions (status, next_retry_at)
  where status = 'failed';

create index if not exists automation_executions_running_idx
  on public.automation_executions (status, locked_at)
  where status = 'running';

insert into public.company_automations (
  company_id,
  automation_key,
  name,
  description,
  enabled
)
select
  company.id,
  item.automation_key,
  item.name,
  item.description,
  false
from public.companies as company
cross join (
  values
    (
      'abandoned_cart',
      'Carrito abandonado',
      'Recupera compras que quedaron abiertas en Shopify.'
    ),
    (
      'order_created',
      'Confirmación de pedido',
      'Confirma automáticamente que el pedido fue recibido.'
    ),
    (
      'payment_confirmed',
      'Pago confirmado',
      'Avisa al cliente cuando Shopify confirma el pago.'
    ),
    (
      'fulfillment_created',
      'Guía o envío creado',
      'Envía la transportadora y la guía cuando estén disponibles.'
    )
) as item(automation_key, name, description)
on conflict (company_id, automation_key) do nothing;

alter table public.company_automations enable row level security;
alter table public.automation_executions enable row level security;

commit;
