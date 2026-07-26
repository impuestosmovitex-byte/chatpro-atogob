alter table public.conversations
  add column if not exists reply_to_provider_message_id text,
  add column if not exists reply_to_message text,
  add column if not exists message_source text,
  add column if not exists source_name text;

create index if not exists conversations_reply_to_provider_idx
  on public.conversations (company_id, reply_to_provider_message_id)
  where reply_to_provider_message_id is not null;

create index if not exists conversations_provider_message_lookup_idx
  on public.conversations (company_id, provider_message_id)
  where provider_message_id is not null;
