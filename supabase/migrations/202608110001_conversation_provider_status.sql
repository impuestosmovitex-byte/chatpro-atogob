alter table public.conversations
add column if not exists provider_error text;

create index if not exists conversations_provider_message_id_idx
on public.conversations (provider_message_id)
where provider_message_id is not null;
