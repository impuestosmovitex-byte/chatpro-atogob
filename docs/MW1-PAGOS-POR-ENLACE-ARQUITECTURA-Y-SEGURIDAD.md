# MW1 — Pagos por enlace desde conversaciones (propuesta técnica)

Estado: **planeación, sin implementación de cobros, sin credenciales ni cuentas enlazadas**.
Alcance inicial: Colombia, MW1 SaaS multiempresa. Entorno de prueba aislado.

## Objetivo
Cuando el cliente dice «quiero pagar», el asesor puede revisar el carrito/cotización
de esa empresa, crear una solicitud y compartir un enlace de pago seguro desde MW1.
La IA puede ayudar a orientar la conversación, pero **no puede inventar precios,
sumar productos ajenos, activar cobros ni afirmar que un pago fue aprobado**.

## Flujo mínimo seguro
1. El asesor abre el pedido/cotización validado por la empresa y comprueba monto, moneda COP, cantidad, referencia y disponibilidad.
2. MW1 verifica el usuario, la empresa activa, los permisos del asesor y los medios de pago habilitados **para esa empresa**.
3. El backend crea la solicitud con referencia irrepetible e idempotencia y usa
   credenciales **exclusivas del comercio**. Se prefiere integración con el proveedor
   que ya contrató el comercio, por ejemplo Wompi o Mercado Pago.
4. MW1 guarda únicamente URL permitida, referencia, importe, empresa, conversación,
   vencimiento y estado `pending`; no guarda información de tarjetas.
5. El asesor envía un mensaje con resumen y URL HTTPS del proveedor autenticado.
   El comprador sigue el enlace a un checkout seguro. No es un formulario de
   tarjetas construido en el chat ni un cobro nativo de WhatsApp.
6. Webhook autenticado + consulta servidor-servidor al proveedor validan importe,
   moneda, referencia y cuenta receptora. Idempotencia evita duplicaciones.
7. Solo entonces el estado cambia a `approved`, `rejected` o `expired`
   y puede mostrarse en el panel. **Ni el clic, ni un redirect ni una foto de comprobante confirman pago**.
8. La conciliación, comisiones, devoluciones y contracargos quedan visibles
   como eventos separados, con trazabilidad y autorizaciones correspondientes.

## Separación de responsabilidades y dinero
- Los clientes de ATOGOB pagan a la cuenta/pasarela contratada por ATOGOB.
- Cada empresa de MW1 conecta sus propias credenciales segregadas, cifradas y
  con permisos mínimos. Las credenciales **nunca** se exponen al navegador ni a la IA.
- Las suscripciones de MW1 (lo que ATOGOB paga a MW1 por el CRM) son **otro flujo
  de facturación**, con su propio comercio, conceptos y registros.
- El nombre de empresa no es una autorización: se valida `company_id` en sesión,
  base de datos, API y webhooks. No se comparten URLs, pedidos o pagos entre empresas.
- En staging usar proveedor sandbox y empresas demo; ninguna transacción real ni
  integración operativa de ATOGOB sin pruebas y aprobación explícita.

## Etapas del desarrollo
1. **Primera versión:** envío manual de links ya emitidos por el proveedor, con
   dominio y referencia permitidos, sin mostrar «pagado» sin comprobación verificable.
2. **Integración:** conexión por empresa, creación programática de links, caducidad,
   referencias y permisos de usuarios; Wompi y/o Mercado Pago según elegibilidad.
3. **Verificación:** webhooks firmados, validación remota e idempotencia; estado
   visible en CRM, notas y eventos de auditoría.
4. **IA asistente:** el bot solo propone el pago de un pedido ya confirmado;
   el envío puede requerir aprobación humana según importe/riesgo.
5. **Ampliaciones:** catálogos, órdenes, inventario, crédito de terceros y pagos
   fraccionados solo tras verificar contratos y APIs de cada proveedor.

## Datos sugeridos (futuras migraciones separadas, no aplicadas)
`company_payment_providers` (secretos cifrados o gestor de secretos),
`payment_requests` (empresa, pedido, monto, COP, referencia, URL, estado),
`payment_events` (proveedor, firma/verificación, idempotencia, timestamp),
`payment_audit` (usuario, tipo de operación, empresa, fecha).

## Controles obligatorios de lanzamiento
- Permisos por empresa y roles; accesos denegados entre tenants.
- Validación de pedido, importe y correspondencia con cuenta receptora.
- URL de proveedor estrictamente validada; bloquear links arbitrarios, phishing
  y redirecciones fuera de proveedores autorizados.
- Sandbox, pruebas de rechazo, expiración, duplicados y reintentos.
- Webhooks firmados + reconciliación remota, no confiar en parámetro recibido.
- Manejo de retenciones, comisiones, contracargos, privacidad y términos propios
  de cada pasarela y cada comercio.

## Referencias oficiales
- Wompi Colombia: https://docs.wompi.co/docs/colombia/links-de-pago/
- Wompi eventos: https://docs.wompi.co/docs/colombia/eventos/
- Mercado Pago Checkout Pro: https://www.mercadopago.com.co/developers/es/reference/online-payments/checkout-pro-orders/overview
- Mercado Pago Webhooks: https://www.mercadopago.com.co/developers/es/docs/checkout-pro-orders/notifications?scope=prod
