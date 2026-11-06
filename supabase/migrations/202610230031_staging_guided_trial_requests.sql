-- STAGING ONLY: extend commercial requests for a supervised 14-day trial.
-- A request is not a subscription, active trial, company, or payment.
alter table public.platform_demo_requests
  drop constraint if exists platform_demo_requests_source_check;
alter table public.platform_demo_requests
  add constraint platform_demo_requests_source_check
  check (source in ('web_demo','web_trial'));
alter table public.platform_demo_requests
  add column if not exists contact_phone text null
   check (contact_phone is null or (char_length(contact_phone) between 7 and 20 and contact_phone ~ '^\\+?[0-9]{7,19}$')),
  add column if not exists whatsapp_setup text null
   check (whatsapp_setup is null or whatsapp_setup in ('business_app','cloud_api','new_number','unsure')),
  add column if not exists trial_requested_days integer null
   check (trial_requested_days is null or trial_requested_days=14),
  add column if not exists trial_activated_at timestamptz null;
comment on column public.platform_demo_requests.trial_activated_at is
 'Only populated following confirmed onboarding by authorized operators; NULL means no active trial. A trial request alone never grants access.';
