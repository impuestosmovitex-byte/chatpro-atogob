-- Fictional staging-only fixtures; never run against ATOGOB production.
-- No real contacts, messages, API credentials, or actual payments.
insert into public.companies(slug,name,status)
values
 ('mw1-demo-mercado','MW1 Demo Supermercado','active'),
 ('mw1-demo-disfraces','MW1 Demo Disfraces','active')
on conflict (slug) do nothing;

insert into public.company_entitlements(company_id,plan_key,ai_enabled,whatsapp_enabled,commerce_enabled,native_orders_enabled,max_catalog_items,max_users,max_whatsapp_lines)
select id,'comercio',true,false,true,true,5000,3,0 from public.companies
where slug in ('mw1-demo-mercado','mw1-demo-disfraces')
on conflict(company_id) do nothing;

insert into public.company_settings(company_id,assistant_name,ai_instructions)
select id, case when slug='mw1-demo-mercado' then 'Asistente de prueba Mercado' else 'Asistente de prueba Disfraces' end,
  'ENTORNO DEMO: Nunca enviar mensajes reales, aceptar pagos reales ni afirmar que estos productos existen en comercios reales.'
from public.companies
where slug in ('mw1-demo-mercado','mw1-demo-disfraces')
on conflict(company_id) do nothing;

insert into public.commerce_delivery_settings(company_id,first_delivery_time,accept_orders_after_hours,customer_instructions)
select id,time '09:00',true,'Pedidos de demostración; no se realizan entregas reales.'
from public.companies
where slug='mw1-demo-mercado'
on conflict(company_id) do nothing;

insert into public.commerce_catalog_sources(company_id,kind,label,status)
select id,'manual','Catálogo ficticio supermercado','ready'
from public.companies where slug='mw1-demo-mercado'
and not exists(select 1 from public.commerce_catalog_sources x where x.company_id=companies.id and x.label='Catálogo ficticio supermercado');

insert into public.commerce_catalog_sources(company_id,kind,label,status)
select id,'pdf','Catálogo PDF ficticio (no hay archivo cargado)','draft'
from public.companies where slug='mw1-demo-disfraces'
and not exists(select 1 from public.commerce_catalog_sources x where x.company_id=companies.id and x.label='Catálogo PDF ficticio (no hay archivo cargado)');

insert into public.commerce_products(company_id,source_id,sku,name,description,base_price,published,available,inventory_tracking)
select c.id,s.id,p.sku,p.name,'Producto de prueba. No disponible para venta real.',p.price,true,true,true
from public.companies c join public.commerce_catalog_sources s on s.company_id=c.id and s.label='Catálogo ficticio supermercado'
cross join (values
  ('DEMO-EGG','Cubeta de huevos',18000::numeric),
  ('DEMO-BREAD','Pan',3000::numeric),
  ('DEMO-CHOC','Chocolate',3000::numeric)
) as p(sku,name,price)
where c.slug='mw1-demo-mercado'
and not exists(select 1 from public.commerce_products x where x.company_id=c.id and x.sku=p.sku);

insert into public.commerce_variants(company_id,product_id,sku,price,unit,stock_quantity,variant_label)
select p.company_id,p.id,p.sku,p.base_price,'unidad',case when p.sku='DEMO-EGG' then 12 else 100 end,'Única'
from public.commerce_products p join public.companies c on c.id=p.company_id
where c.slug='mw1-demo-mercado'
and not exists(select 1 from public.commerce_variants v where v.company_id=p.company_id and v.sku=p.sku);

insert into public.commerce_orders(company_id,order_code,channel,status,payment_status,currency,subtotal,delivery_fee,grand_total,customer_snapshot,customer_note)
select id,'DEMO-0001','whatsapp','pending_confirmation','unpaid','COP',33000,0,33000,
  '{"display_name":"Cliente ficticio"}'::jsonb,
  'Pedido de demostración, SIN pago ni entrega real.'
from public.companies where slug='mw1-demo-mercado'
on conflict(company_id,order_code) do nothing;

insert into public.commerce_order_items(company_id,order_id,variant_id,product_name,variant_label,quantity,unit_price)
select o.company_id,o.id,v.id,p.name,'Única',
  case p.sku when 'DEMO-EGG' then 1 when 'DEMO-BREAD' then 2 else 3 end::numeric,
  v.price
from public.commerce_orders o join public.commerce_products p on p.company_id=o.company_id
join public.commerce_variants v on v.company_id=p.company_id and v.product_id=p.id
join public.companies c on c.id=o.company_id
where c.slug='mw1-demo-mercado' and o.order_code='DEMO-0001'
and not exists(select 1 from public.commerce_order_items oi where oi.company_id=o.company_id and oi.order_id=o.id);

-- Never insert real provider payment events in a demo seed.
