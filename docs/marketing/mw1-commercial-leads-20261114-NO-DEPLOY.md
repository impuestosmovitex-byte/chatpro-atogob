# MW1 comercial — implementación aislada (2026-11-14)

## Alcance realizado
- /inicio: se retira Telegram y elementos que parecían canales aprobados; se reemplaza la fotografía vinculada a MAOGO por la vista ilustrativa existente de MW1, identificada como ficticia. Enlaces de captación a /agendar-demo.
- /por-que: contenedor responsivo de video en preparación (sin archivo ni reproducción falsa), con seis capítulos del guion (mensajes dispersos → centralización → IA → asesor → clientes y estadísticas → demo). Se retira la promesa de prueba gratis en los CTA principales.
- /agendar-demo: formulario público que reutiliza DemoRequestForm y el endpoint ya existente; solo se muestra en staging bajo el flag existente.
- /integraciones: se retira Telegram y chat web no validado, ajustando las afirmaciones de disponibilidad.
- En el controlador de solicitudes staging se conserva el WhatsApp para solicitudes de demo cuando existe, reutilizando la columna existente `contact_phone`. **No despliegue**.

## Contrato existente verificado
`DemoRequestForm` → `/api/marketing/demo-request` → API `POST /marketing/demo-requests` → `platform_demo_requests`.
La API exige clave interna, modo staging, consentimiento y firma hash del IP; aplica límite 3 solicitudes por hash en 24 horas. El frontend valida origen HTTPS del staging y tiene campo honeypot. Esto no constituye control antispam suficiente para producción: quedan pendiente protección distribuida y límites por teléfono/correo.

## Campos pendientes de almacenamiento (NO activados)
El usuario solicita **sector**, **tiene tienda virtual** y preferencias de comunicaciones separadas. No añadimos campos visuales que aparenten guardarse sin persistencia real: requieren revisar el esquema, definir columnas o estructura de metadatos, validación y autorización explícita antes de migrar. El nombre, empresa, correo y WhatsApp sí usan el flujo existente.

## Futura entrada al CRM MW1
Formulario → registro en `platform_demo_requests` → validación comercial → deduplicación de contacto por empresa + WhatsApp normalizado/correo → creación/actualización autorizada de contacto en empresa interna comercial **aún no creada** → tareas de seguimiento → agenda → demo → oportunidad comercial → contratación supervisada.
Nunca mezclar leads comerciales de MW1 con ATOGOB o MAOGO ni usar compañías productivas por defecto. Requiere autorización de empresa interna, permisos tenant-aware y proceso idempotente. No se ejecutan mensajes.

## Calendar/Meet — arquitectura prevista y no implementada
1. Verificar proveedor y calendario autorizado sin usar cuentas personales por defecto.
2. Backend verifica eventos free/busy en ventana de agenda por token OAuth de menor privilegio.
3. Reservar horario atómicamente: bloqueo temporal con expiración e idempotency key; revalidar free/busy antes del evento.
4. Crear evento Google Calendar con Meet, guardar `external_event_id`, `meeting_url`, timezone `America/Bogota`, prospecto, estado y auditoría.
5. Confirmaciones solo por correo autorizado; WhatsApp únicamente con consentimiento específico, número verificado y plantilla aprobada por Meta.
6. Mostrar agenda al administrador autorizado; permitir reprogramación/cancelación y reconciliación de fallas.

No existe en este cambio una agenda en tiempo real. El formulario solicita contacto para coordinación manual.

## Riesgos y validaciones pendientes
- No se ejecutó build/test de Next.js o NestJS contra entorno local. Revisar CI del PR antes de considerar merge.
- Revisar columna `contact_phone` y compatibilidad con persistencia real. No migraciones.
- Revisar política/aviso de privacidad y consentimiento granular de contacto vs marketing.
- Video oficial y capturas reales, con datos personales anonimizados.
- Completar campos sector/sitio con esquema revisado y prueba e2e de persistencia.
- Verificar compatibilidad con PR #44 y SEG-003 antes de cualquier despliegue.
- **NO MERGE. NO DEPLOY.** No se cambia login, Railway, credenciales, Meta, WhatsApp, Shopify ni datos reales.

## Avance 2 — captación sin migración (14 noviembre 2026)
- La página /agendar-demo solicita nombre, empresa, WhatsApp, correo, sector y presencia web.
- Se distinguen dos autorizaciones: obligatoria para gestionar la solicitud; opcional para noticias/promociones MW1. **No se activa ninguna campaña.**
- Se validan sector y tipo de sitio web con listas cerradas en API. Los valores de calificación y permiso opcional se persisten provisionalmente en `platform_demo_requests.internal_note`; el consentimiento para gestionar la solicitud sigue en `consent_at`. No afirmar que son columnas separadas ni usar la nota como autorización para un envío sin revalidación.
- El endpoint frontend transfiere los campos a la API; la API mantiene el registro exclusivo staging, la protección del secreto y la limitación por IP. La deduplicación por correo en 24h es una mejora de conveniencia, **no** garantía transaccional ante concurrencia.
- Tests de API actualizados para validar estos datos; workflow CI solo compilación y pruebas unitarias, sin conexión a Railway/Supabase y sin despliegue.
- Pendientes antes del piloto externo: URL y contenido definitivo de política de privacidad, versionado y prueba de consentimiento, esquema formal para calificación, antispam distribuido, idempotencia transaccional, captura de evidencia de origen, validación admin y pruebas end-to-end. La conexión de Meta sigue desactivada.

## Avance 3 — pantalla dedicada de prospectos (sin nuevo endpoint)
- Nueva vista `/admin/prospectos` para superadministrador; enlazada desde el menú y página /admin.
- Reutiliza exclusivamente GET `/api/platform-admin/demo-requests`, que exige sesión de plataforma y autorización de Super Admin en API. No usa claves ni consultas a base en el navegador.
- Presenta las últimas 50 solicitudes retornadas por la API, conteo de nuevas y seguimientos, filtro por estado y búsqueda local. El día de corte se calcula en `America/Bogota`.
- No crea ni modifica reuniones, clientes, empresas, planes, consentimiento ni conversaciones. Los cambios de estado siguen realizándose en la sección existente Empresas. Las notas de calificación se muestran solo tras autenticación.
- Limitación explícita: las estadísticas de la pantalla describen la muestra cargada y no el universo completo de leads. Necesita paginación, reportes y RLS revisados antes de ser un panel analítico definitivo.
- No exponer esta vista fuera de staging antes de validación de acceso de usuario de empresa, usuario no autenticado y Super Admin.
