# MW1 staging: auditoría previa a migraciones y despliegue

Fecha: 2026-10-22. Proyecto de staging Supabase: `zqfbxqszfnrbwpfukwak`. **No ejecutar en producción.**

## Hechos verificados (lectura directa, sin modificaciones)
- `list_migrations` devuelve **16 migraciones aplicadas**, hasta `mw1_visual_variant_integrity_20261021`.
- `information_schema.tables` confirma `public.platform_admins` y `public.company_entitlements`, pero no `platform_commercial_plan_drafts`, `platform_published_plan_prices`, `platform_demo_requests`, `platform_ai_usage_events` ni `platform_ai_model_rates`.
- `companies` y `company_entitlements` tienen RLS activado.
- El último build de GitHub Actions observado (`c1606c7b`) pasó, lo cual NO sustituye integración con DB y Railway.
- NO se ejecutaron migraciones ni se desplegó la rama.

## Secuencia y dependencias (requieren aprobación y verificación)
1. `202610210018_staging_demo_inquiries.sql`: tabla aislada de solicitudes demo; confirmar flujo de planes nuevos `basico/eco/pro` frente a claves heredadas `inicial/pro/empresa` para evitar rechazos.
2. `202610210019_staging_commercial_plan_drafts.sql`: crea tabla de borradores, base para migraciones 021 y 022.
3. `202610220020_staging_published_plan_prices.sql`: crea snapshot público (consultado solo por servidor autenticado).
4. `202610220021_staging_plan_addon_prices.sql`: agrega tarifas extra; depende de tablas 019 y 020.
5. `202610220022_staging_plan_benefits_ai_budget.sql`: agrega descripción, lista de beneficios, presupuesto IA; depende de 019/020.
6. `202610220023_staging_ai_usage_metering.sql`: medición aislada por tenant; depende de `companies`.
7. `202610220024_staging_ai_model_rates.sql`: precios verificados por modelo; tabla independiente.
8. Migraciones comerciales `202610210016_rich_catalog_import_staging.sql` y `202610210017_staging_catalog_price_audit.sql` se deben **posponer** hasta validar versión compatible de API y rollback: sus comentarios advierten expresamente no aplicarlas sin despliegue aislado.

## Bloqueadores antes de usar funciones en staging
- No asumir que los 16 registros de Supabase equivalen exactamente a los nombres de los archivos GitHub. Revisar historial y esquema actual.
- La migración de solicitudes demo solo acepta claves anteriores; la web pública usa `basico/eco/pro`. Reconciliar de forma retrocompatible antes de probar envío de demos.
- El editor comercial usa claves antiguas asignadas temporalmente a nombres nuevos; no migrar `company_entitlements` ni contratos de clientes sin estrategia validada.
- El reporte de IA solo mide eventos instrumentados del agente principal, no todas las rutas OpenAI; NO es consumo total ni base para factura/limitación.
- La tabla `platform_ai_model_rates` no contiene tarifas comprobadas: conservar vacío hasta consultar precios vigentes y documentar vigencia.
- Aplicación de tablas en DB debe ir acompañada de despliegue coordinado y pruebas `superadmin -> draft -> published snapshot -> /precios`.
- Confirmar autorización superadmin real, RLS/grants, aislamiento multiempresa, lectura anónima fallida, idempotencia de IA, ausencia de credenciales en cliente, y acceso de staging estrictamente separado de producción.
- Evitar habilitar automáticamente pago, publicaciones o límites IA. Probar pantalla E2E y flujos WhatsApp -> IA -> humano antes de comercializar.

## Plan de validación
1. Recuperar despliegue Railway Hobby y verificar proyecto/entorno/commit antes de cualquier cambio de entorno.
2. Tomar inventario de schema y rollback/backup **solo staging**; resolver clave de planes/demos.
3. Aplicar migraciones de manera ordenada y verificarlas con consultas a `information_schema`, roles y RLS.
4. Verificar CRUD de borradores solo superadmin, publicación explícita y lectura pública segura sin credenciales expuestas.
5. Prueba multitenant: tenant A jamás ve datos B; repetición de evento IA no duplica; reportes incompletos advierten cobertura.
6. Registrar resultado, errores y rollback de cada prueba. No desplegar a producción sin aprobación explícita.
