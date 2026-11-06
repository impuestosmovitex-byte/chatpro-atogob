# MW1 — Catálogos universales y administración conversacional

**Fecha:** 21 de octubre de 2026
**Entorno:** rama aislada `feature/mw1-saas-staging-20261020`. No desplegar en producción ATOGOB.

## Requisito de producto

Cada empresa puede vender desde:
- **Shopify**, mediante integración y sus productos/variantes.
- **WooCommerce sobre WordPress**, mediante REST API autenticada. Una web WordPress sin WooCommerce se trata como catálogo web de lectura, NO como WooCommerce.
- **Tiendanube / Nuvemshop**, mediante API, con identificadores externos de productos/variantes.
- **Excel / CSV**, con carga de datos y fichas revisadas antes de guardar.
- **PDF**, inicialmente texto digital simple; los escaneados requieren OCR y control de ambigüedad.
- **Carga manual** o una **web/landing** que exponga información del catálogo.

MW1 debe mostrar *un solo catálogo para la atención comercial*, con `company_id`, `source_id`, referencia externa, SKU, variante, nombre, descripción, precio, inventario, fotos, fecha de actualización y origen verificables. **No afirmar que todos los conectores están programados actualmente**: el esquema incluye las clases de fuente, pero sus integraciones deben implementarse y probarse individualmente.

## Autoridad de datos y actualización

| Fuente | Autoridad del precio | Actualizar / sincronizar |
| --- | --- | --- |
| Manual | MW1 | Editar en MW1 con confirmación |
| Excel / CSV | Catálogo local MW1 creado desde importación | Cambio local autorizado; volver a importar debe resolver SKU existente y respetar los cambios explícitos del administrador |
| PDF | Catálogo local MW1 extraído del documento | Cambio local autorizado; el PDF original **no cambia**, reimportación futura con revisión |
| Shopify | Shopify | En etapa posterior: escritura GraphQL Admin con permiso `write_products`, ID de variante externo, lectura de regreso y webhook |
| WooCommerce / WordPress | WooCommerce | En etapa posterior: REST API de variaciones/productos, credenciales propias por empresa, reconciliación |
| Tiendanube | Tiendanube | En etapa posterior: API de variantes con permisos, ID externo y confirmación de estado |
| Web/landing sin integración | Página original | Lectura y actualización por rastreo autorizado; no escribir en sitio ajeno |

No convertir automáticamente un precio local de una integración a escritura externa. **Primero verificar capacidades y scopes**, y nunca guardar credenciales de tiendas en mensajes o logs. Las actualizaciones de una fuente externa se deben confirmar **en el proveedor** y reflejar luego en MW1; fallos/reintentos llevan auditoría y estado `pending/failed/succeeded`.

**Precios de venta ≠ costos internos.** Cuando un usuario dice «costo», pedir precisión y no asumir venta. Los datos de costos deben tener sus propios permisos y esquema.

## Asistente de administración: 2 fases

1. **Propuesta**, sin escritura: autenticar dueño/admin, interpretar precio nuevo, recuperar datos reales `company_id`, mostrar posibles SKU/variantes, origen, precio actual y destino. Nunca escoger arbitrariamente cuando existan varias tallas/colores.
2. **Confirmación explícita**: admin pulsa «Confirmar» luego de seleccionar variante. Una RPC de staging valida la pertenencia a su empresa, precio anterior exacto, moneda, fuente, permisos, y escribe en una transacción. El `request_key` idempotente evita duplicados y una auditoría registra antes/después.

La confirmación **nunca la ejecuta una respuesta de OpenAI por sí sola**. La primera versión entiende órdenes sencillas mediante reglas; un futuro modelo puede proponer *intenciones estructuradas*, nunca saltarse las verificaciones de precio/usuario/origen ni los botones de aprobación.

### Estado del trabajo en GitHub (sin despliegue)

- `apps/api/src/staging-catalog-admin-command.ts`: política de fuentes, reconocimiento de instrucciones y referencias, sin escrituras.
- `apps/api/src/native-commerce.controller.ts`: vistas previas, listado de fuentes y endpoint de confirmación para empresas autorizadas, solo staging.
- `app/catalogo/asistente/page.tsx`: pantalla de instrucciones, candidatos, confirmación y orígenes.
- `supabase/migrations/202610210017_staging_catalog_price_audit.sql`: RPC transaccional y auditoría, **NO APLICADA**.
- Pruebas GitHub: reconocimiento de 20 mil, identificación de SKU, variantes ambiguas, distinción precio/costo, y prohibición de cambiar tiendas externas.

### Qué falta antes de usarlo con clientes

1. Aplicar la migración únicamente en Supabase de staging cuando se pueda probar API/web.
2. Desplegar GitHub staging en Railway de pruebas (ningún cambio en ATOGOB).
3. Probar manualmente cambio correcto, revisión de auditoría, cambios simultáneos, reintentos, SKU erróneos, fuente externa y aislamiento multiempresa.
4. Diseñar página de conexión/autorización con permisos por proveedor y estado de sincronización.
5. Construir conectores WooCommerce y Tiendanube, y reutilizar la integración Shopify de forma aislada.
6. Implementar sincronización delta + webhooks idempotentes + cuotas, y reconciliación de precios/inventarios/fotos.
7. Diseñar importación de reemplazo inteligente de Excel/PDF que NO borre cambios confirmados en MW1 sin mostrar conflicto.
8. Mejorar clasificación con OpenAI exclusiva de staging, probar con catálogos variados y registrar costos/errores.

## Referencias oficiales para futuras integraciones

- Shopify: https://shopify.dev/docs/apps/build/product-merchandising/products-and-collections/update-data
- WooCommerce: https://woocommerce.github.io/woocommerce-rest-api-docs/
- Tiendanube: https://tiendanube.github.io/api-documentation/resources/product-variant

*Nota:* la migración 017 está en GitHub y requiere aplicación controlada y pruebas de integración; que compile no demuestra que haya sido ejecutada en el motor SQL.
