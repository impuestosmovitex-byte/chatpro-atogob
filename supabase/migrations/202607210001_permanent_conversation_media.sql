alter table public.conversations
  add column if not exists media_storage_path text;

create index if not exists conversations_media_storage_path_idx
  on public.conversations (media_storage_path)
  where media_storage_path is not null;

insert into storage.buckets (id, name, public, file_size_limit)
values ('chatpro-media', 'chatpro-media', false, 15728640)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;
