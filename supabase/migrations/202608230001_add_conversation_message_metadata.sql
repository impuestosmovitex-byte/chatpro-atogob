alter table public.conversations
add column if not exists message_metadata jsonb;

comment on column public.conversations.message_metadata is
'Metadatos estructurados del mensaje según su tipo, por ejemplo ubicación con latitude, longitude, name y address.';
