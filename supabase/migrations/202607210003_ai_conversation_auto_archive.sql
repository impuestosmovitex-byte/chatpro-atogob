alter table public.company_support_settings
  add column if not exists ai_auto_archive_enabled boolean not null default true,
  add column if not exists ai_auto_archive_hours integer not null default 12;

alter table public.company_support_settings
  drop constraint if exists company_support_settings_ai_auto_archive_hours_check;

alter table public.company_support_settings
  add constraint company_support_settings_ai_auto_archive_hours_check
  check (
    ai_auto_archive_hours >= 1
    and ai_auto_archive_hours <= 720
  );

create index if not exists conversation_sessions_ai_archive_idx
  on public.conversation_sessions (
    company_id,
    attention_status,
    pending_count,
    last_message_at
  )
  where attention_status = 'ai';
