-- STAGING ONLY: correct literal '+' validation for trial lead phone numbers.
-- This change does not touch operational companies or their integrations.
alter table public.platform_demo_requests
 drop constraint if exists platform_demo_requests_contact_phone_check;
alter table public.platform_demo_requests
 add constraint platform_demo_requests_contact_phone_check
 check (contact_phone is null or
   (char_length(contact_phone) between 7 and 20
    and contact_phone ~ '^[+]?[0-9]{7,19}$'));
