-- MW1 staging only. Sales follow-up metadata belongs to platform staff, not tenants.
-- Recording a qualified lead MUST NOT activate WhatsApp, a trial or a paid plan.
alter table public.platform_demo_requests
 add column if not exists internal_note text not null default ''
   check (char_length(internal_note)<=1000),
 add column if not exists next_followup_on date null;
comment on column public.platform_demo_requests.internal_note is
 'Superadmin private sales notes. No passwords, Meta codes, tokens or card data.';
comment on column public.platform_demo_requests.next_followup_on is
 'Optional follow-up date for manual sales work. No automatic messages, accounts or trial activations.';
