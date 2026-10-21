# MW1 — sprint de staging: pedidos nativos (21/10/2026)

**Rama exclusiva:** `feature/mw1-saas-staging-20261020`
**Base separada:** Supabase `zqfbxqszfnrbwpfukwak`
**Railway separado:** `mw1-saas-staging` / `staging`
**Producción ATOGOB:** sin merges ni cambios aplicados.

## Implementado en esta rama
- SQL `202610210003_native_order_transitions.sql`: función atómica de transición de estado, bloquea cambios inválidos, exige membresía activa owner/admin, verifica empresa y módulos contratados, conserva el estado de pago y escribe evento.
- SQL `202610210004_staging_identity_roles.sql`: rol base propietario, administrador, asesor y metadatos Super Admin de staging.
- `apps/api/src/native-commerce.controller.ts`: consulta de pedidos, detalle, listado de productos, validación de acceso y ruta PATCH para avanzar estados.
- `apps/api/src/staging-app.module.ts`: módulo mínimo Nest exclusivo de pruebas, sin Shopify, Meta, WhatsApp, agentes de IA, webhooks ni tareas programadas.
- `apps/api/src/main.ts`: selecciona módulo mínimo solo cuando `MW1_STAGING_MODE=true`, producción sigue usando `AppModule`.
- `apps/api/src/staging-safety.ts`: detiene el arranque si la URL de Supabase no es `zqfbxqszfnrbwpfukwak`, si faltan claves de staging o si hay credenciales externas configuradas.
- `apps/api/src/staging-safety.spec.ts`: casos de prueba unitarios, aún no ejecutados en CI.
- `apps/api/src/supabase.service.ts`: revisión de conectividad usando la tabla `companies` de la base aislada.
- `app/lib/native-commerce-proxy.ts` y rutas bajo `app/api/native-commerce`: usan cookie firmada de sesión y transportan empresa + usuario desde el servidor, nunca desde el navegador como parámetro confiable.
- `app/pedidos/page.tsx` y CSS module: primer listado de pedidos, filtros, pago/estado independientes, avance de estado y detalle.
- `apps/api/scripts/seed-staging-demo.mjs`: aprovisionamiento posterior de usuario propietario ficticio, exige variables secretas nuevas y base staging; no se ha ejecutado.

## Verificaciones efectuadas en Supabase staging
- 27 tablas; 27 con RLS activo.
- 0 tablas con SELECT para rol `anon`.
- 4 migraciones aplicadas exclusivamente en el proyecto `zqfbxqszfnrbwpfukwak`.
- RPC `mw1_commerce_transition_order`: acceso DENEGADO a `anon` y `authenticated`, habilitado solo al backend `service_role`.
- Prueba negativa: usuario UUID sin membresía al intentar avanzar `DEMO-0001` devuelve ERROR 42501 `El usuario no tiene permiso para operar pedidos`.
- Los pagos ficticios no se han aprobado ni registrado transacciones reales.

## Railway: servicios todavía NO desplegados
- El API apunta a la rama de trabajo y tiene `MW1_STAGING_MODE=true`, `SUPABASE_URL` de pruebas, configuración Nest build/start y healthcheck.
- La web apunta a rama de trabajo y a la URL de red privada del API. Tiene `MW1_STAGING_MODE=true`.
- Ambos servicios siguen `staged-create`; no tienen despliegue activo.

## Configuración pendiente, solo desde Railway Dashboard
Nunca pegar claves en GitHub, tickets, chats ni código.

API `mw1-api-staging`:
1. `SUPABASE_SECRET_KEY` — secreto **del proyecto de pruebas** `zqfbxqszfnrbwpfukwak`; no usar el de ATOGOB.
2. `CHATPRO_INBOX_KEY` — generar clave interna nueva y aleatoria de al menos 32 caracteres.
3. `SUPABASE_URL` ya staged; verificar que apunta a Supabase staging.
4. `MW1_STAGING_MODE=true` ya staged.

Web `mw1-web-staging`:
1. `CHATPRO_INBOX_KEY` — exactamente el mismo secreto interno nuevo de la API de staging.
2. `CHATPRO_INBOX_SESSION_SECRET` — generar otro secreto nuevo y aleatorio de al menos 32 caracteres.
3. `CHATPRO_API_URL` ya staged; verificar red privada de servicio staging.
4. `MW1_STAGING_MODE=true` ya staged.

El aprovisionamiento del demo requiere `MW1_DEMO_OWNER_PASSWORD` temporal, de al menos 12 caracteres, ejecutando `node scripts/seed-staging-demo.mjs` en el servicio de API de staging (nunca producción). El script no está programado para ejecución automática ni tiene claves integradas.

## Bloqueadores para primer deploy
- No se han configurado las credenciales privadas.
- No se han compilado ni ejecutado tests de Jest/Next en un runner real.
- No hay usuario demo de Supabase Auth aprovisionado.
- Faltan pruebas completas de login, aislamiento y transiciones desde la UI.
- Aún no existe un elemento de menú 'Pedidos' habilitado por entitlement: la primera página está en la ruta `/pedidos` y depende de una sesión válida.
- No están implementados: subir PDF/CSV, inventario operacional, pasarela de pago, confirmación de cobros por webhook, guías de transportadora, ni el CRM legado completo dentro de staging.
- **No aceptar los cambios pendientes en Railway ni desplegar hasta validar lo anterior y recibir autorización explícita de despliegue.**

## Riesgo ATOGOB
Producción continúa en proyecto Railway independiente. Existe un despliegue fallido previo de `chatpro-web` en la rama `main`, pero Railway informó que el despliegue anterior permanece ONLINE; el presente trabajo no hizo cambios de producción.
