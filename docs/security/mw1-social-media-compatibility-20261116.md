# MW1 — Compatibilidad de archivos sociales (16 noviembre 2026)

## Objetivo y alcance

Evaluación estática y sintética para el PR #73. **No se ha publicado**, no se usan tokens, mensajes ni archivos reales y no se modifican servicios ni bases de datos.

## Origen de media_url en la API

- Mensajes entrantes de Messenger/Instagram: `meta-social-message.service.ts` y `meta-social-batch-message.service.ts` extraen `message.attachments[].payload.url` y pasan `mediaUrl` al almacenamiento de mensajes sociales.
- Archivos enviados por asesor: `meta-social-messaging.service.ts` guarda `media_url: storagePath` (ruta interna de Storage).
- La descarga en `InboxController.getMessageMedia` utiliza URL externa por HTTPS o descarga el path interno de `chatpro-media`, tras comprobar empresa, membresía y permiso `inbox.view`.

Referencias oficiales de Meta: 
- https://developers.facebook.com/docs/messenger-platform/getting-started/quick-start (Messenger attachment payload.url).
- https://developers.facebook.com/docs/graph-api/reference/message (message attachments y CDN URL).
Estas fuentes documentan el campo de URL, **no garantizan** los hosts/redirects/tamaños de cada mensaje recibido.

## Matriz de compatibilidad y seguridad

| Caso | Política propuesta | Validación | Riesgo restante |
| --- | --- | --- | --- |
| HTTPS CDN de Meta en `*.fbcdn.net`, `*.fbsbx.com`, `*.cdninstagram.com` | Permitir | Jest con URLs sintéticas, incluyendo query simulada de firma | URL real podría usar host diferente |
| HTTPS `graph.facebook.com`, `graph.instagram.com`, lookaside | Permitir | Jest con ejemplos sintéticos | Endpoint real puede requerir autenticación o redirigir |
| Storage `chatpro-media` (path interno) | Usar Storage | Jest de controlador simulado con 3 bytes | Requiere prueba integrada con Storage en entorno aislado |
| `http:`, localhost, IP internas, host malicioso, credenciales, puerto inusual | Rechazar | Jest + integración simulada | Política DNS/egress requiere defensa adicional de infraestructura |
| Redirección HTTP 301/302/307/308 | Rechazar sin seguir | Integración simulada 302 | Meta podría usar redirección legítima: **compatibilidad pendiente** |
| Descarga >15 MiB o tiempo >10 s | Rechazar | Prueba simulada de `content-length`, guardas estáticas de streaming/timeout | Vídeos/archivos grandes legítimos podrían bloquearse |
| Sin membresía, empresa equivocada, sin `inbox.view` | Rechazar antes de leer mensaje | Jest controller simulado | Falta E2E HTTP real autenticado |

## Evaluación

**Se pueden verificar sin riesgo** las reglas de host/sintaxis, autorización y descargas sintéticas y compilar la API. Eso no certifica las URL reales de Meta, expiración de firmas, redirecciones, contenido MIME ni tamaños efectivos.

**Antes de autorizar despliegue**, utilizar una empresa ficticia/piloto aislado que no sirva mensajes reales: recibir imágenes y archivos propios de prueba de Instagram/Messenger; comprobar estado HTTP, dominio final y si hubo redirección, **sin registrar query strings, firmas, tokens, nombres o bytes de clientes**; probar 200 autorizado, 403 ajeno y caducidad del enlace; verificar que multimedia de más de 15 MiB tenga una política de producto explícita. Si Meta usa otro dominio/redirección, **no abrir la allowlist indiscriminadamente**: inventariar el host exacto, verificar propiedad/control y añadirlo con prueba; revalidar todo destino de redirección y limitar saltos antes de admitirlo.

Se mantiene PR #73 como **DRAFT sin merge ni despliegue**. No reclamar compatibilidad real hasta completar los casos anteriores.
