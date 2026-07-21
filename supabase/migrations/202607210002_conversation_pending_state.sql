alter table public.conversation_sessions
  add column if not exists pending_count integer not null default 0,
  add column if not exists pending_since timestamptz null;

alter table public.conversation_sessions
  drop constraint if exists conversation_sessions_pending_count_check;

alter table public.conversation_sessions
  add constraint conversation_sessions_pending_count_check
  check (pending_count >= 0);

create index if not exists conversation_sessions_pending_priority_idx
  on public.conversation_sessions (
    company_id,
    pending_count,
    pending_since,
    last_message_at desc
  );

create or replace function public.chatpro_sync_conversation_pending_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  message_author text;
  message_time timestamptz;
begin
  message_author := coalesce(
    nullif(trim(new.author_type), ''),
    case
      when new.sender = 'customer' then 'customer'
      else 'ai'
    end
  );

  message_time := coalesce(new.created_at, now());

  if message_author = 'customer' then
    update public.conversation_sessions
    set
      pending_count = coalesce(pending_count, 0) + 1,
      pending_since = coalesce(pending_since, message_time)
    where id = new.session_id;
  else
    update public.conversation_sessions
    set
      pending_count = 0,
      pending_since = null
    where id = new.session_id;
  end if;

  return new;
end;
$$;

drop trigger if exists chatpro_conversation_pending_state
  on public.conversations;

create trigger chatpro_conversation_pending_state
after insert on public.conversations
for each row
execute function public.chatpro_sync_conversation_pending_state();

with last_non_customer as (
  select
    cs.id as session_id,
    max(c.created_at) filter (
      where coalesce(
        nullif(trim(c.author_type), ''),
        case when c.sender = 'customer' then 'customer' else 'ai' end
      ) <> 'customer'
    ) as last_response_at
  from public.conversation_sessions cs
  left join public.conversations c
    on c.session_id = cs.id
  group by cs.id
),
current_pending as (
  select
    cs.id as session_id,
    count(c.id)::integer as pending_count,
    min(c.created_at) as pending_since
  from public.conversation_sessions cs
  left join last_non_customer lnc
    on lnc.session_id = cs.id
  left join public.conversations c
    on c.session_id = cs.id
   and coalesce(
     nullif(trim(c.author_type), ''),
     case when c.sender = 'customer' then 'customer' else 'ai' end
   ) = 'customer'
   and (
     lnc.last_response_at is null
     or c.created_at > lnc.last_response_at
   )
  group by cs.id
)
update public.conversation_sessions cs
set
  pending_count = cp.pending_count,
  pending_since = case
    when cp.pending_count > 0 then cp.pending_since
    else null
  end
from current_pending cp
where cp.session_id = cs.id;
