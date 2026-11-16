# MW1 — Puerta de entrada para una prueba real de multimedia social

**Fecha:** 16 de noviembre de 2026  
**Estado:** Preparación solamente. **NO HABILITADA PARA EJECUCIÓN.**  
**Alcance:** PR #73 (SEG-004) y hallazgo #72. Sin acceso a medios reales, sin publicación, sin modificación de ATOGOB/MAOGO.

## Hallazgo de arquitectura: staging no ejecuta el código a probar

Se verificaron los SHAs y ramas que Railway reporta para staging:
- API: `mw1-api-staging`, fuente `feature/mw1-contract-api-staging-integration-20261114` SHA `62ed66436d386b33b863799016eb9d2db4c8a1f6`.
- Web: `mw1-web-staging`, fuente `feature/mw1-manual-contract-target-confirmation-20261115` SHA `ab81f35da83a3a2f32850209da50587b1516619e`.

La API selecciona `StagingAppModule` con `MW1_STAGING_MODE=true`. Este módulo monta `StagingInboxController`, **no** `InboxController`. La Bandeja de staging ofrece `GET /inbox`, `GET /inbox/:sessionId` solo para conversaciones sintéticas y `GET /inbox/instagram-pilot` de diagnóstico. **No expone `GET /inbox/:sessionId/messages/:messageId/media`**, endpoint donde se corrigió SEG-004. Su detalle devuelve `messages: []`. No sustituir el controller sin revisión separada de aislamiento.

Instagram:
- `StagingInstagramWebhookController` está registrado, exige firma y empresa piloto exacta; la recepción está controlada por `MW1_STAGING_INSTAGRAM_RECEIVE_ENABLED` (valor en Railway NO leído en esta auditoría).
- La recepción se almacena en una tabla de diagnóstico; no demuestra el flujo de descarga de `InboxController` del PR #73.
- No registrar la aplicación productiva de Meta apuntando a la URL staging.

Messenger:
- `GET /integrations/messenger/config` en `StagingIntegrationsController` declara `ready:false`, `authorizationEnabled:false`, `connectionEnabled:false` y ausencia de OAuth de servidor, permisos y suscripción verificados. **No hacer onboarding ni redirigir webhooks todavía**.

## Puertas de seguridad ANTES de habilitar una prueba con Meta

1. Preparar un servicio aislado de pruebas basado en el commit revisado del PR #73, con copia segregada de DB/storage y **únicamente** cuentas/medios sintéticos. No usar claves ni copias de datos de clientes.
2. Definir un handler de descarga habilitado **solo** para fixtures etiquetados y un usuario piloto, en ambiente y dominio separados. Bloquear envíos, automatizaciones y webhooks de producción. Confirmar `StagingAppModule` y route map real. Necesita revisión y autorización específica antes de desplegarlo.
3. Conectar únicamente una cuenta ficticia de Instagram **ya aprobada para piloto**, con consentimiento y credenciales independientes. No reutilizar la suscripción de la cuenta productiva. Para Messenger, no iniciar pruebas reales hasta que OAuth, titularidad, permisos y suscripción estén verificados.
4. Probar lectura autorizada `200` y rechazos `401/403` sin acceso a otra empresa; rechazos **antes de leer** Storage o URL. Usar archivos creados para pruebas (PNG pequeño, PDF sintético, video menor a 15 MiB).
5. Registrar **solamente** código HTTP, estado de autorización, host normalizado de Meta, si hubo redirección, tipo MIME y banda de tamaño. **No registrar** tokens, consultas URL completas, firmas, nombres de clientes, mensajes ni bytes.
6. Verificar compatibilidad: URL CDN firmada vigente y caducada, respuesta 302 y host destino (no seguir sin validación), archivo de tamaño 15 MiB o más, timeout, almacenamiento interno y expiración.
7. Despliegue condicionado a aprobación específica, pruebas de compilación, validación de seguridad, reversión disponible y comparación con el controller exacto instalado. **Mantener PR #73 DRAFT** mientras falten las puertas anteriores.

## Evidencia disponible y límites

- Se aprobaron la compilación NestJS, las pruebas de política URL, pruebas de autorización/descarga con mocks y otras regresiones del PR #73; son evidencias automatizadas, **no E2E HTTP**.
- No existe aún una ejecución de la API con el PR #73 en la que se haya descargado multimedia real ni una prueba comprobada del flujo de enlace firmado de Meta.
- Estado recomendado: **BLOQUEADO PARA DESPLIEGUE**, **LISTO PARA DISEÑAR un piloto aislado**. Para realizar la prueba real hace falta implementación aislada + autorización expresa.

## Operación

**Sigo yo:** revisión de código y CI sin credenciales.  
**Te toca a ti:** solo cuando se necesite iniciar sesión de la cuenta **piloto**, aprobar una conexión **piloto** o proporcionar una imagen creada para pruebas. No tocar cuentas comerciales.  
**Dime OK para seguir:** antes de crear/desplegar cualquier servicio nuevo o cambiar configuraciones, incluso staging.
