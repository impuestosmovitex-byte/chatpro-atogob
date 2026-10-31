# MW1 — Hoja de ruta de comercio conversacional

## Objetivo
Vender por WhatsApp, Instagram y Messenger: catálogo, variantes, inventario, pedido, selección del medio de pago y checkout del comercio. El comprador puede abrir una página protegida del proveedor; la conversación y el pedido permanecen registrados en MW1.

## Arquitectura y seguridad
- Cada negocio configura su cuenta propia de cobro. La cuenta de suscripciones de MW1 no debe cobrar ventas de sus comercios.
- No recoger números de tarjeta, CVV ni contraseñas de banca por mensajes.
- Recalcular precios, impuestos, envío y stock en backend antes de emitir enlaces.
- Cada intento de cobro tendrá empresa, pedido, proveedor, importe, moneda, referencia idempotente, estado y vencimiento.
- No mostrar un método hasta verificar la conexión activa de ese comercio.
- Confirmar pago solo ante webhook auténtico y consulta al proveedor, cotejando comercio, pedido, moneda e importe. Nunca confirmar por captura del comprador.
- PSE se ofrecerá bajo un proveedor habilitado; financiación Addi/Sistecrédito requiere convenio e integración comprobada.

## Plan por etapas
1. Modelo unificado de medios de pago y configuración por empresa (Mercado Pago, Bold, financiación, transferencia).
2. Carrito y pedido nativo con cantidades, variantes, stock, entrega, descuentos y total calculado por servidor.
3. Checkout alojado (sandbox) por Mercado Pago y Bold: enlace de pago creado en la cuenta del comercio, no de MW1.
4. Webhooks y conciliación segura, deduplicación, auditoría, reintentos y vencimientos.
5. Integraciones de Addi, Sistecrédito y transferencia solo tras confirmar API/contrato y proceso de conciliación.
6. WhatsApp con SIM de prueba, Instagram Direct y Messenger: autorización y ruteo estrictamente multiempresa.
7. Shopify, WooCommerce, Tiendanube, PDF/Excel/CSV: catálogo normalizado y sincronización verificable.
8. Ronda integral acordada con un piloto: compras, pagos sandbox, IA, operador humano, canales y pruebas de aislamiento.

## Estado comprobado
- Existen pedidos nativos y campos de estado de pago, pero falta checkout real multiempresa.
- El inicio de Embedded Signup de WhatsApp abre desde MW1; falta autorización de nuevo número y recepción real.
- Conexiones productivas de ATOGOB y MAOGO deben permanecer intactas.
- El registro de medios de pago es una base sin cobros ni activación de canales.

## Requisito para lanzar
No anunciar una integración hasta probar permisos, uso real, webhook y seguridad multiempresa. Todo en rama staging, sin afectar main.