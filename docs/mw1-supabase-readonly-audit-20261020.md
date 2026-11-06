# MW1 — auditoría Supabase de solo lectura (octubre 2026)

**Alcance:** inspección de metadatos y avisos de seguridad con la conexión autorizada de Supabase. No se han realizado escrituras en ninguna base de datos.

## Inventario
Organización: `impuestosmovitex-byte's Org` (plan Pro).

Existen **dos proyectos distintos** denominados `Chatpro-atogob`:
- Ref `ynmwgerlfidwsihmzgkw`: 33 tablas públicas.
- Ref `lttucfblydpaljfboxro`: 38 tablas públicas, incluyendo `company_entitlements`, `platform_admins` y tablas de conversaciones sociales.

**IMPORTANTE:** No está demostrado aún cuál ref utiliza la API activa de Railway. Verificar por referencia al `SUPABASE_URL` de producción **sin copiar valores secretos a GitHub**. Nunca crear tablas de pruebas ni cargar datos de staging en estos dos proyectos.

## Hallazgos de metadatos — ref lttucfblydpaljfboxro
1. 21/38 tablas en `public` sin RLS, incluidas `conversations`, `contacts`, `orders`, `conversation_sessions`, `social_conversations` y `company_settings`.
2. Para esas 21 tablas se observaron privilegios SELECT concedidos al rol `anon`, por lo que debe tratarse como un **riesgo potencial de acceso a información**. La existencia de privilegios NO prueba exfiltración, pero exige revisar exposición por API y controles efectivos.
3. Advisor de Supabase marca `rls_disabled_in_public` con nivel ERROR y 21 hallazgos.
4. Advisor marca 4 funciones `SECURITY DEFINER` invocables por `anon`; revisar necesidad y privilegios EXECUTE, sin cambios directos sin ensayo previo.
5. Advisor marca funciones con `search_path` mutable, 12 tablas con RLS sin política (puede ser deliberado con backend service-role) y protección contra contraseñas filtradas desactivada.

Referencias:
- https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public
- https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable

## Acciones de mitigación requeridas antes de comercialización
- [ ] Comprobar qué proyecto de Supabase es realmente producción, por metadata sin revelar secretos.
- [ ] Solicitar confirmación de organización y costo antes de crear nuevo proyecto Supabase `mw1-saas-staging`.
- [ ] Preparar nuevo proyecto separado, con esquema versionado y datos sintéticos.
- [ ] Revisar grants, RLS, SECURITY DEFINER y funciones RPC con una matriz de acceso por rol/empresa.
- [ ] Implementar y probar cambios en staging, incluidos flujos existentes de ATOGOB y rutas de webhook.
- [ ] Preparar respaldo, monitoreo, pruebas de regresión y procedimiento de reversión.
- [ ] **No cambiar configuración ni RLS de ninguna base existente sin autorización específica.**

## Infraestructura de staging ya preparada
- GitHub: `feature/mw1-saas-staging-20261020`.
- Railway: `mw1-saas-staging` con servicios API y Web solo como cambios staged (no desplegados).
- Ninguna credencial ni base conectada todavía a staging.
