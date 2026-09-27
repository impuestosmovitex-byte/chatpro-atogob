alter table public.social_conversation_sessions
  add column if not exists agent_stage text not null default 'active';

alter table public.social_conversation_sessions
  add column if not exists agent_context jsonb not null default '{}'::jsonb;

comment on column public.social_conversation_sessions.agent_stage
  is 'Etapa comercial persistente usada por el motor compartido de IA.';

comment on column public.social_conversation_sessions.agent_context
  is 'Contexto comercial persistente del motor compartido para Instagram y Messenger.';
