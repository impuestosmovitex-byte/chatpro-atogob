begin;

alter table public.company_cart_recovery_rules
  add column if not exists message_body text;

update public.company_cart_recovery_rules
set message_body = case sequence
  when 1 then E'Hola {{nombre_cliente}} 👋\n\nVimos que dejaste productos en tu carrito:\n{{resumen_carrito}}\n\nPuedes retomar tu compra aquí:\n{{enlace_checkout}}'
  when 2 then E'Hola {{nombre_cliente}} 👋\n\nTu carrito todavía está disponible.\n\nPuedes retomarlo aquí:\n{{enlace_checkout}}'
  when 3 then E'Hola {{nombre_cliente}} 👋\n\nEste es el último recordatorio de tu carrito.\n\nRetoma tu compra aquí:\n{{enlace_checkout}}'
  else message_body
end
where sequence in (1, 2, 3)
  and nullif(trim(message_body), '') is null;

commit;
