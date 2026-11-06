# MW1 Staging — estado verificable (2026-10-21)

## Recursos activos y separados
- Supabase STAGING: project ref `zqfbxqszfnrbwpfukwak` — NO ES ATOGOB.
- GitHub: `feature/mw1-saas-staging-20261020` (rama separada de main).
- Railway STAGING: project `4cc3fcfb-a07e-42d4-9dd3-28ae80b4dc91`, environment `119d67ce-a983-4215-98cd-84ffc6c8ec47`.
- Staged services: `mw1-api-staging` (root /apps/api) and `mw1-web-staging` (root /).
- Ambos servicios usan la rama de trabajo y mantienen sus cambios **staged, no desplegados**.

## SQL aplicado, solo en Supabase staging
- `supabase/migrations/202610210001_staging_core_baseline.sql`.
- `supabase/migrations/202610210002_native_commerce_staging.sql`.
- 26 tablas creadas (13 CRM-base, 13 comercio), todas con RLS habilitado.
- Las 26 tablas tienen SELECT denegado para los roles `anon` y `authenticated`; `service_role` cuenta con SELECT.
- La auditoría Supabase indica RLS sin políticas para las 26 tablas; esto es **intencional** en este esquema de prueba cerrado a acceso directo. Se requieren rutas con identidad y permisos en backend.
- Tabla `company_entitlements` incorpora flags `commerce_enabled` y `native_orders_enabled`. **La lógica de API para hacerlos cumplir todavía no está implementada**.

## Datos ficticios y tests
- Archivo `supabase/seeds/20261021_mw1_staging_fictitious_demo.sql` ejecutado solamente en staging.
- Empresa `mw1-demo-mercado`: 1 catálogo manual, 3 productos, 1 orden `DEMO-0001` por COP 33.000, con 3 artículos; estado `pending_confirmation`, pago `unpaid`.
- Empresa `mw1-demo-disfraces`: fuente PDF de ejemplo en borrador, sin documento real ni productos.
- Test de consistencia: total de líneas = COP 33.000 = total de orden.
- Test negativo: la FK compuesta rechaza asociar ítems de un pedido de una empresa a otra.
- Ningún token Meta, proveedor de pago, Shopify o OpenAI fue clonado. No hay mensajes a clientes ni movimientos de dinero.

## Railway variables STAGED no secretas
- Backend: `SUPABASE_URL=https://zqfbxqszfnrbwpfukwak.supabase.co`; `PORT=8080`; `CHATPRO_COMPANY_SLUG=mw1-demo-mercado`.
- Web: `CHATPRO_API_URL=http://mw1-api-staging.railway.internal:8080`; `CHATPRO_DEFAULT_COMPANY=mw1-demo-mercado`.
- **No hay variables secretas configuradas.** No realizar un deployment de los servicios hasta tener credenciales exclusivas de pruebas y validar seguridad/rutas.

## Bloqueadores anteriores al primer deploy
1. Instalar/adaptar el esquema CRM base completo (conversaciones sociales, automations, estadísticas, diagnósticos, RPCs, roles, permisos, triggers y tablas auxiliares). La base de 26 tablas NO equivale todavía al backend completo: los scripts antiguos de este repositorio eran incrementales, no incluían un baseline completo.
2. Auditar que el backend no pueda usar fallback de credenciales de Shopify, Meta ni OpenAI de ATOGOB.
3. Crear y configurar con seguridad **en Railway staging** un `SUPABASE_SECRET_KEY` exclusivo del nuevo proyecto, `CHATPRO_INBOX_KEY` exclusivo, secreto de sesión web y cualquier otra variable requerida. Nunca pegarlas en GitHub, en chats ni en logs.
4. Verificar env variables, estado del catálogo demo, escritura/lectura por empresa, permisos y denegación entre empresas; bloquear envíos externos (sin WhatsApp real ni números de clientes).
5. Probar migraciones y app, antes de pedir permiso explícito para aplicar cambios staged de Railway (que inicia despliegue).
6. Desarrollar rutas/controllers para catálogo universal, carrito nativo, orden, pago validado con webhooks y fulfillment; hoy el SQL NO implementa funciones de negocio.
7. Mantener el proyecto ATOGOB (`main` / Railway production / sus proyectos Supabase) sin cambios; no hacer merge ni aplicar migraciones allí.

## Seguridad pendiente
La revisión de solo lectura en el proyecto con registros de producción `lttucfblydpaljfboxro` reveló alertas de RLS y permisos `anon`. Se requiere mitigación diseñada y probada en staging antes de sugerir cambios en producción; nunca cambiar las tablas de ATOGOB durante este desarrollo.
