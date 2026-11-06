# MW1 staging — verificación de migraciones comerciales

Revisión: noche del 22 de octubre de 2026, hora Bogotá (registros de migración UTC del 23 de octubre).

## Entorno y cambios efectuados

Proyecto Supabase de pruebas: `zqfbxqszfnrbwpfukwak`. No se modificó Railway, la rama `main`, suscripciones actuales ni la base de producción.

Se aplicaron mediante Supabase las siguientes **siete** migraciones en orden:
1. `mw1_staging_demo_requests` — `202610210018_staging_demo_inquiries.sql`
2. `mw1_staging_commercial_plan_drafts` — `202610210019_staging_commercial_plan_drafts.sql`
3. `mw1_staging_published_plan_prices` — `202610220020_staging_published_plan_prices.sql`
4. `mw1_staging_plan_addon_prices` — `202610220021_staging_plan_addon_prices.sql`
5. `mw1_staging_plan_benefits_ai_budget` — `202610220022_staging_plan_benefits_ai_budget.sql`
6. `mw1_staging_ai_usage_metering` — `202610220023_staging_ai_usage_metering.sql`
7. `mw1_staging_ai_model_rates` — `202610220024_staging_ai_model_rates.sql`

## Verificaciones realizadas directamente en la base de pruebas

- Supabase devuelve éxito para las siete migraciones y las muestra en su historial.
- Existen las cinco tablas comerciales/IA requeridas.
- Todas tienen RLS activado.
- `anon` y `authenticated` **no tienen SELECT** en ninguna de las cinco tablas.
- `service_role` tiene SELECT; el acceso de los usuarios debe mediarse por API con controles de autorización.
- Contadores de las cinco tablas: **0 filas**, por lo que no se publicaron precios, se crearon cuentas ni se generaron registros de consumo artificiales.
- El advisory de Supabase muestra advertencias informativas `rls_enabled_no_policy` en tablas privadas. Es esperado para el patrón service-role + revocación de accesos cliente, pero requiere revisión de cada endpoint; referencia: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy

## Lo que estas comprobaciones NO validan

- No se verificó un flujo real de superadmin -> guardar borrador -> publicar -> página pública. Requiere API/web desplegadas en staging; no hacer publicación de prueba desde SQL en ausencia de API.
- No se verificó aislamiento entre empresas a través de los endpoints y componentes internos. RLS por sí sola no elimina riesgos si backend usa service_role; se necesitan pruebas de autorización por empresa.
- La instrumentación de IA es parcial, y no hay tarifas de modelos registradas; no usar este reporte para facturar o bloquear.
- Las migraciones de catálogo rico y auditoría de precios **siguen sin aplicar** hasta coordinar el despliegue compatible.

## Siguiente secuencia

1. Revisar backend y añadir pruebas de autorización de superadmin y lectura de precios publicados, sin tocar entitlements.
2. Recuperar acceso a Railway staging, confirmar entorno/commit e implementar despliegue coordinado de API y web.
3. Ejecutar ensayo funcional de drafts, publicación y lectura, usando precios claramente ficticios y luego limpiar los datos de ensayo.
4. Ejecutar pruebas de aislamiento cruzado entre empresas y controles negativos por token/usuario.
5. Solo después, evaluar lanzamiento de nuevos clientes; producción no cambia sin aprobación.
