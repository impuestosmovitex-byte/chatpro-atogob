-- ChatPro: audios bidireccionales en conversaciones.
-- Ejecutar una sola vez en Supabase SQL Editor. Es idempotente.

alter table public.conversations
  add column if not exists media_id text,
  add column if not exists media_mime_type text,
  add column if not exists media_filename text,
  add column if not exists media_voice boolean not null default false;

create index if not exists conversations_media_id_idx
  on public.conversations (media_id)
  where media_id is not null;

comment on column public.conversations.media_id is
  'Identificador de contenido multimedia entregado por Meta.';
comment on column public.conversations.media_mime_type is
  'Tipo MIME informado por Meta o usado al enviar.';
comment on column public.conversations.media_filename is
  'Nombre orientativo del archivo multimedia.';
comment on column public.conversations.media_voice is
  'Indica si el audio fue recibido como nota de voz.';
