# MW1 — Lanzamiento comercial: Super Admin, planes y catálogos de cada empresa

**Corte: 21 de octubre de 2026.** Este documento fija qué funciona, qué se añadió en la rama de desarrollo y qué aún NO está integrado ni desplegado.

## Producto que vamos a comercializar primero

MW1 como CRM multiempresa con IA: WhatsApp, Instagram, Messenger según conexiones verificadas, contactos, bandeja, asesores humanos, IA de ventas/servicio, leads, automatizaciones y estadísticas.

**No bloquear comercialización por extras de comercio:** PDF complejo, Excel inteligente, WooCommerce, Tiendanube, pedidos internos, visión avanzada y cambios de precio por conversación son módulos posteriores.

## Estado por componente

| Módulo | Estado técnico comprobable | Próximo hito |
|---|---|---|
| Super Admin /admin/empresas | Existe. Crea compañía, propietario inicial, módulos y límites de usuarios | Validar permisos con dos empresas aisladas |
| Panel de incorporación | Agregado en rama de pruebas: señales de acceso, registros de canales, errores y pasos siguientes; **solo lectura** | Publicar en staging y ejecutar prueba con empresas de ejemplo |
| Login y cambio de empresa | Código e interfaz existentes y usados en ATOGOB/Maogo | Pruebas adversariales de acceso cruzado |
| /inicio, /demo, /integraciones | Páginas públicas creadas | Revisar promesas de cada conector y convertir CTA demo en solicitud real |
| /precios | Tarjetas Inicial, Pro, Empresa; importes **por definir** | Aprobar tarifas COP, usuarios, líneas, IA y costos de Meta/OpenAI |
| Cobro de suscripción / registro automático | **No terminado**; crear empresa por admin sí existe | Elegir proveedor de pagos, webhook verificado, tabla de eventos e idempotencia |
| Añadir usuarios a un plan | Límite de usuarios por empresa en DB; admin de usuarios existente | Cobro de asientos extra, actualización transaccional del límite, aviso y auditoría |
| Observabilidad por empresa | Integraciones y estado registrados. Diagnóstico inicial, no prueba de salud real | Añadir conteos de fallos y último evento de cada tenant con privacidad y permisos |
| Shopify para IA | Integración real y lectura de catálogo presentes en el CRM existente | Verificar IA por empresa y reconexiones en la beta |
| WooCommerce / Tiendanube para IA | Futuros adaptadores, **aún no son conectores E2E** | Autorización, sincronización, normalización y fuentes de verdad por tenant |
| Excel / CSV / PDF para IA | Importador local en rama staging, PDF digital básico; IA propia de staging | Migraciones, despliegue, comparación con catálogo Shopify; no mezclar empresas |

## Flujo comercial seguro (propuesta definitiva)

1. Cliente visita `/inicio`, consulta `/precios`, ve demo y solicita alta o demostración. **Solicitar no crea usuario ni empresa.**
2. MW1 recibe la solicitud y la muestra solo al Super Admin como **pendiente de asesoría**. Validar consentimiento para conservar datos comerciales.
3. Cliente selecciona el plan. Si realiza pago, **solo la notificación verificada del proveedor** confirma que se recibió. Nunca activar por un texto de «ya pagué», retorno de navegador o captura de comprobante.
4. La plataforma crea o activa compañía (tenant) y un propietario, con membresía, límites del plan y módulos contratados, mediante flujo transaccional e idempotente.
5. Cliente inicia sesión y ve la guía de parametrización: datos, usuarios, canales autorizados, horarios, base de conocimiento, personalización de IA, prueba entrante y derivación a humano.
6. El Super Admin ve una secuencia: `solicitud` → `pago verificado` → `empresa creada` → `configuración asistida` → `prueba real aprobada` → `activa`.
7. Si se compra un asiento adicional, nuevo pago confirmado → se aumenta `max_users` del tenant correspondiente → se invita/activa el usuario → historial de quién/cuándo y límite renovado. No crear cuentas desde un webhook sin comprobaciones.
8. Cancelación, mora y reembolsos requieren reglas de acceso, periodo de gracia y conservación/exportación de datos definidas previamente.

## Panel Super Admin: qué puede y NO puede mostrar

**Debe mostrar:** empresas, estado activo/inactivo, plan, límite y cantidad de usuarios, módulos, canales registrados, si existen errores, fecha de último evento verificado, estado del onboarding, solicitudes y pagos confirmados, incidentes por empresa (sin divulgar datos innecesarios), alertas y prueba de configuración.

**Límite técnico importante:** el estado `active` de una integración expresa un registro configurado; **no** confirma que Meta, Shopify o el modelo estén respondiendo ahora. Un test de salud debe ser independiente, auditado y protegido, sin enviar mensajes a clientes reales por accidente.

**Seguridad:** solo `platform_admins.active=true` puede ver otras empresas. Propietarios de cada empresa solo ven su tenant. Logs y pruebas no deben incluir accesos, credenciales, datos sensibles ni conversaciones cruzadas. No ofrecer botones de «suplantar cliente» o cambiar de empresa sin registro de auditoría y permiso explícito.

## IA con catálogo intercambiable

**Una sola interfaz normalizada por empresa**, con adaptadores detrás:

`companyId + catalogSource + productId + variantId + SKU + title + description + tags + color + size + price + currency + available + stock + images + updatedAt + sourceUrl`

- **Shopify:** API por tienda autorizada. La fuente manda precio/stock; actualizaciones en tienda y sincronización hacia MW1.
- **WooCommerce:** REST API de productos/variaciones, credenciales específicas del tenant. No suponer que WordPress por sí solo tiene WooCommerce.
- **Tiendanube:** API con tienda y tokens individuales; respetar variantes y estado del inventario.
- **Excel/CSV:** importación aprobada, validación de SKU, columnas y variantes; reimportación con prevención de duplicados y revisión de conflictos.
- **PDF:** texto digital básico primero, páginas escaneadas por OCR/visión después; coincidencias ambiguas piden confirmación humana.

La IA consulta **solo el catálogo verificado de la empresa activa**. Nunca inventa precio, existencias o variantes. La foto no demuestra un SKU único. El modelo propone; el backend verifica identidad, permisos, fuentes y valores.

## Planes comerciales — pendientes de aprobar

No inventar precios. Antes de publicar importes debemos definir como mínimo:
- Plan Inicial: canales, límite de usuarios/líneas, volumen de conversaciones, soporte y qué IA incluye.
- Plan Pro: IA comercial/servicio, automatizaciones, límites y usuarios adicionales.
- Plan Empresa: límites, servicio asistido, SLA, personalización y precio a cotizar.
- Cargo por usuario extra: facturación recurrente o única, alta inmediata solo tras pago verificado, prorrateo y cancelación.
- Política de costos externos: Meta/WhatsApp, OpenAI, Shopify y demás integraciones.

## Checklist priorizado de desarrollo

- [x] D01 Verificar que Super Admin, alta de empresas, permisos y páginas de marketing ya existen en el repositorio.
- [x] D02 Programar señales iniciales de incorporación y conectores en el panel de Super Admin, sin exponer secretos.
- [x] D03 Añadir al backend aislado de staging el controlador administrativo ya existente para poder probar empresas, sin habilitar webhooks reales.
- [ ] D04 Verificar la nueva pantalla y la creación de dos tenants en staging tras recuperar despliegues.
- [ ] D05 Crear solicitud de demo con consentimiento, control anti-spam y bandeja administrativa (no concede accesos).
- [x] D06a Crear borradores comerciales privados para Inicial, Pro y Empresa, editables solo por Super Admin en staging, con COP, usuarios, líneas y módulos. Código y pruebas preparados; migración 019 aún NO aplicada.
- [ ] D06b Aprobar importes, límites y reglas de usuarios adicionales/costos Meta/OpenAI. Los borradores NO son tarifas públicas ni modifican los contratos o límites actuales.
- [ ] D07 Desarrollar cobro confirmado por webhook del proveedor, idempotencia y auditoría; **sin activación por retorno del navegador**.
- [ ] D08 Activación de empresa/usuarios asistida tras compra y onboarding verificable.
- [ ] D09 Agregar observabilidad real por tenant (canal, último webhook, cola, fallos, costos IA) sin exponer mensajes.
- [ ] D10 Adaptadores WooCommerce y Tiendanube y vinculación Excel/PDF a la misma IA de producción, una vez beta validada.

**No lanzar escritura automatizada ni facturación sin D04–D09 probados.**
El CRM comercial básico con alta y cobro **manual verificado** puede venderse antes, cumpliendo las cinco pruebas críticas del plan de lanzamiento del CRM con IA.

## Implementación reciente de planes — solamente staging

- Interfaz interna: `/admin/planes`; existe enlace desde `/admin/empresas`.
- Rutas protegidas: `GET/POST /platform-admin/plans/drafts` y proxy de sesión. Se valida Super Admin en el backend y `MW1_STAGING_MODE=true`.
- Migración pendiente: `supabase/migrations/202610210019_staging_commercial_plan_drafts.sql`.
- Cada plan puede mantenerse como **borrador**, o pasar a **listo para revisión interna** con precio y límites completos. Ninguno se publica ni genera cobros.
- La página comercial mantiene los importes **por definir** hasta la aprobación de precios. Elegir «Solicitar demo» conserva el plan como interés, pero no confirma un pago.
- **No aplicar migración en ATOGOB ni conectar estos borradores directamente a `company_entitlements`.** La asignación del plan se realizará solamente mediante proceso independiente de cobro verificado o incorporación guiada aprobada.
- Siguiente puerta: el propietario comercial aprueba precio COP, usuarios incluidos, líneas de WhatsApp, IA incluida, soporte, costos de Meta, volumen y política de usuarios adicionales. Hasta ese momento, ningún precio es oficial.

## Riesgos técnicos y estado del despliegue

- No aplicar migraciones de catálogo/pedidos sin backup y versión staging alineada.
- No sustituir API de producción por `StagingAppModule`: excluye intencionalmente canales, automatizaciones y webhooks reales.
- Incidente de Railway: atender comunicación de seguridad y rotación de credenciales antes del siguiente despliegue.
- Todas las nuevas señales del Super Admin están en GitHub, **no en la interfaz publicada**.
