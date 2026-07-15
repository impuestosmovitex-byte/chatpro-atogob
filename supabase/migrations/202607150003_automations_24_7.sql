begin;

update public.company_automations
set
  allowed_days = array[0,1,2,3,4,5,6]::smallint[],
  send_window_start = '00:00',
  send_window_end = '00:00',
  updated_at = now();

update public.company_automations
set
  enabled = false,
  updated_at = now()
where automation_key = 'payment_confirmed';

update public.company_cart_recovery_rules
set
  delay_minutes = case sequence
    when 1 then 5
    when 2 then 45
    when 3 then 720
    else delay_minutes
  end
where sequence in (1, 2, 3);

update public.company_cart_recovery_rules
set active = false
where sequence > 3;

commit;
