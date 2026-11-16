# MW1 SEG-004 — Diseño técnico de laboratorio aislado de multimedia social

**Estado:** diseño y configuración validable por código, **sin crear ni desplegar servicios**. Fecha: 2026-11-16. PR #73 en borrador, issue #72.

## Decisión de arquitectura

No reutilizar `mw1-api-staging`, la base Supabase de staging ni el despliegue de producción. El código actual de la rama del PR #73 arranca `AppModule` desde `apps/api/src/main.ts`; eso registra controladores operativos, webhooks y servicios. **No es seguro desplegarlo como laboratorio por el mero hecho de definir una variable de entorno**. La API staging existente sí aísla usando `StagingAppModule`, pero no registra la ruta `GET /inbox/:sessionId/messages/:messageId/media` corregida.

**Opción seleccionada para futura implementación, sin desplegar todavía:** crear un entrypoint Node/Nest **específico del laboratorio** y un módulo minimalista que solo permita diagnósticos de salud y `GET /lab/media/:fixtureId` sobre fixtures sintéticos. NO montar directamente `InboxController` porque incorpora endpoints POST de envío, toma de conversación y transferencia. La verificación exacta del algoritmo PR #73 se hace dentro de tests de integración sintéticos y, para la prueba online futura, por un servicio de descarga puro extraído de su handler. La nueva ruta de laboratorio debe delegar en **la misma política de autorización y descarga** y no duplicar una versión más permisiva.

## Topología propuesta

```text
Tester autorizado
  |
  | HTTPS + credencial efímera de laboratorio + rate limiting
  v
Railway: proyecto y entorno NUEVOS (no existentes)
  servicio único: mw1-social-media-lab (no expuesto hasta autorización)
    entrypoint propio, módulo mínimo /health y /lab/media/:fixtureId
    sin controladores operativos ni cron/queues/IA/bots
    solo fixtures con IDs aleatorios y expiración
  |
  +--> Supabase NUEVO exclusivo de laboratorio (solo datos ficticios)
  +--> bucket PRIVADO NUEVO exclusivo de laboratorio (sin media real)
  +--> peticiones salientes opcionales hacia Meta CDN mediante proxy de egress aprobado
```

## Variables y configuración: solo nombres, nunca valores

**Obligatorias para cualquier despliegue futuro:**
- `MW1_MEDIA_LAB_MODE=true` y `MW1_MEDIA_LAB_ALLOW_START=true` — doble habilitación exclusiva del entrypoint.
- `MW1_MEDIA_LAB_DATASET_ID` — identificador del conjunto de fixtures con marca `synthetic`.
- `MW1_MEDIA_LAB_PROJECT_ID` — ID del nuevo proyecto aprobado. El preflight debe exigir coincidencia exacta con el host de `SUPABASE_URL`; esta comparación **no sustituye** la verificación manual de que no sea un proyecto productivo.
- `MW1_MEDIA_LAB_AUTH_SECRET` — secreto exclusivo efímero del laboratorio; nunca reutilizar `CHATPRO_INBOX_KEY`.
- `SUPABASE_URL` y clave de acceso del **nuevo proyecto laboratorio**, con permisos mínimos; no compartir URLs ni service_role del staging/producción.
- `MW1_MEDIA_LAB_STORAGE_BUCKET` — nombre de bucket privado exclusivo del proyecto laboratorio.

**Deben permanecer ausentes, verificadas automáticamente antes de arrancar:** `DATABASE_URL` comercial, `CHATPRO_API_URL`, `CHATPRO_INBOX_KEY`, `META_WHATSAPP_APP_SECRET`, `META_INSTAGRAM_APP_SECRET`, `META_MESSENGER_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN`, `SHOPIFY_ACCESS_TOKEN`, credenciales de Instagram/Facebook/WhatsApp comerciales, `REDIS_URL` y claves de pago. Prohibir cualquier variable `MW1_STAGING_*` heredada. Evitar importación de variables compartidas en Railway.

**Reglas de protección al arrancar:**
- Rechazar el inicio si faltan los dos interruptores de laboratorio, si existen variables comerciales o si URL de base/storage apunta a un proyecto conocido de producción/staging.
- Mantener una lista literal de IDs de proyectos Supabase **prohibidos**, revisada por seguridad, pero sin introducir secretos. El deployment plan debe exigir una confirmación humana de que el proyecto nuevo NO comparte credenciales ni datos.
- Devolver solo metadatos de fixture; no almacenar ni registrar URLs con firmas, parámetros query, tokens, archivos ni mensajes.
- IP/rate limits y autorización efímera; `Cache-Control: no-store`, bloqueos por tenant, expiración y tamaño. Denegar acceso por defecto.
- Preflight de DNS/egress y verificación posterior a DNS/redirecciones para prevenir SSRF y DNS rebinding. `parseTrustedSocialMediaUrl` por sí sola NO equivale a protección egress completa.

## Secuencia segura del despliegue FUTURO (NO ejecutar ahora)

1. PR independiente de laboratorio (o commits aislados revisables), tests de que **no hay POST** y que no se importa `AppModule`, checks de no-escritura y controles de arranque.
2. Crear proyecto Supabase nuevo sin importar respaldos, usuarios, productos ni secretos. Añadir únicamente dos tenants ficticios, dos asesores ficticios y archivos creados exclusivamente para QA.
3. Crear un proyecto Railway nuevo, sin variables compartidas ni dominios productivos; desplegar sin activar egress exterior. Verificar health y rechazos por defecto 401/403/404; registrar un rollback/plan de destrucción.
4. Habilitar de manera explícita y temporal la obtención de multimedia de una cuenta Meta de piloto a través de redes permitidas, sin cambiar la URL de webhooks comerciales ni conectar Messenger antes de su onboarding.
5. Ejecutar matriz 200/401/403/404, URL HTTPS Meta, redirect, caducidad, DNS, 15 MiB, timeout, logs seguros. Mantener las capturas sin información de clientes.
6. Desactivar inmediatamente acceso/egress, rotar credenciales y destruir recursos temporales tras verificación.

## Evidencia existente

- PR #73: comprobaciones estáticas, URL Jest, tests sintéticos del controlador e integración HTTP en memoria; CI verificado como SUCCESS en commits anteriores.
- El staging API actual usa `StagingInboxController` sin descargas; **no sirve para probar la ruta corregida**.
- Sin prueba real de la URL firmada Meta; no afirmar compatibilidad.
- Todas las acciones de infraestructura (incluido crear proyecto, service, base, dominio, variables o despliegue) requieren **autorización nueva, específica y explícita**. El OK actual cubre solo diseño.

## Condición de aprobación antes de crear infraestructura

Debe existir primero código del entrypoint separado y pruebas negativas de arranque, sin acceso a data productiva. Después solicitar autorización inequívoca que nombre el nuevo servicio de laboratorio y la ausencia de conectividad a la operación. No desplegar PR #73 por sí solo a Railway.
