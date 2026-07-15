begin;

update public.company_cart_recovery_rules
set
  delay_minutes = 5,
  active = true
where sequence = 1;

insert into public.company_cart_recovery_rules (
  company_id,
  sequence,
  delay_minutes,
  message_instructions,
  delivery_mode,
  template_name,
  template_language,
  active
)
select
  base.company_id,
  2,
  45,
  'Envía un segundo recordatorio corto y amable para retomar la compra. Comparte el enlace exacto del checkout. No inventes descuentos, urgencia, stock ni condiciones.',
  base.delivery_mode,
  base.template_name,
  base.template_language,
  true
from public.company_cart_recovery_rules as base
where base.sequence = 1
  and not exists (
    select 1
    from public.company_cart_recovery_rules as existing
    where existing.company_id = base.company_id
      and existing.sequence = 2
  );

insert into public.company_cart_recovery_rules (
  company_id,
  sequence,
  delay_minutes,
  message_instructions,
  delivery_mode,
  template_name,
  template_language,
  active
)
select
  base.company_id,
  3,
  720,
  'Envía el tercer y último recordatorio para retomar la compra. Incluye el bono únicamente cuando esté definido en las instrucciones de la empresa; no inventes su valor ni sus condiciones. Comparte el enlace exacto del checkout.',
  base.delivery_mode,
  base.template_name,
  base.template_language,
  true
from public.company_cart_recovery_rules as base
where base.sequence = 1
  and not exists (
    select 1
    from public.company_cart_recovery_rules as existing
    where existing.company_id = base.company_id
      and existing.sequence = 3
  );

update public.company_cart_recovery_rules
set
  delay_minutes = 45,
  active = true,
  message_instructions =
    'Envía un segundo recordatorio corto y amable para retomar la compra. Comparte el enlace exacto del checkout. No inventes descuentos, urgencia, stock ni condiciones.'
where sequence = 2;

update public.company_cart_recovery_rules
set
  delay_minutes = 720,
  active = true,
  message_instructions =
    'Envía el tercer y último recordatorio para retomar la compra. Incluye el bono únicamente cuando esté definido en las instrucciones de la empresa; no inventes su valor ni sus condiciones. Comparte el enlace exacto del checkout.'
where sequence = 3;

update public.company_cart_recovery_rules
set active = false
where sequence > 3;

commit;
