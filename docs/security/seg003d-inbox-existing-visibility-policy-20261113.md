# MW1 — SEG-003D | Política de Bandeja vigente y alcance de endurecimiento
**Fecha:** 2026-11-13. **Estado:** auditoría de código, sin despliegue. **Regla:** preservar comportamiento existente; no inferir restricciones de áreas ni asignaciones.

## Fuentes revisadas
- `apps/api/src/inbox.controller.ts` (controlador general; especialmente `actor`, `canView`, `assertManageOwn`, `takeAvailability` y transferencias).
- `apps/api/src/staging-inbox.controller.ts` (dos operaciones GET de solo lectura).
- `apps/api/src/conversation-memory.service.ts` (filtros por empresa, historial y estados).
- `app/api/inbox/route.ts` y `app/api/inbox/instagram-pilot/route.ts` (sesión web y proxies).
- `apps/api/src/seg003-inbox-tenant-isolation.spec.ts` (roles y separación entre empresas).

## Política demostrada por código — NO cambiar sin autorización adicional

| Actor / condición | Lectura de conversaciones de su propia empresa | Administración / respuesta |
| --- | --- | --- |
| Propietario activo | Acceso amplio a Bandeja tras validación de rol efectivo y permiso `inbox.view` | Capacidades de supervisión; límites de tenant siguen vigentes |
| Administrador activo | Igual que propietario bajo `inbox.view` | Acceso amplio en operaciones soportadas, sin cambiar tenant |
| Asesor activo con `inbox.view` | **Lectura compartida** de conversaciones de la empresa: `canView` devuelve `true` para un actor que ya fue autorizado. La asignación NO limita la lectura según la regla actual | Gestionar/responder exige `inbox.reply` u otro permiso específico y asignación propia, salvo tomar conversaciones conforme a `inbox.take_all`, `inbox.take_ai`, `inbox.take_waiting` y `inbox.take` |
| Usuario inactivo, membresía revocada o sin `inbox.view` | DENEGAR | DENEGAR |
| Cualquier usuario respecto a otra empresa | DENEGAR: contexto de empresa y filtros por `company_id` | DENEGAR |

### Conversaciones compartidas y sin asignar
- `canView` actual permite lectura compartida dentro de la empresa, aun si el asesor no es el asignado. **No modificar a “solo asignados”.**
- `takeAvailability` conserva reglas explícitas para esperar, IA, conversaciones asignadas y `inbox.take` legado; no ampliar privilegios al firmar solicitudes.
- Búsquedas por teléfono, nombre, contenido y filtros de estado/asesor **deben aplicar el mismo control de identidad, empresa y permiso** que la lista normal, sin revelar información de otra empresa.
- En el controlador general, algunas búsquedas pueden devolver tarjetas restringidas (`historyRestricted`) para conversaciones que se pueden tomar; conservar esa semántica.

### Transferencias
- Para asesor no pleno, transferir exige `inbox.reply` y que la conversación esté asignada al actor; el destinatario debe tener rol/membresía/permisos válidos para recibir.
- No se concede nueva autoridad por conocer el identificador de sesión o el destinatario.
- Mantener los caminos de WhatsApp/Instagram/otros canales sin modificaciones en esta etapa.

### Archivadas / cerradas
- La implementación emplea estado `closed` y `closed_at`; no se verificó una entidad independiente `archived` en las dos rutas de staging.
- El controlador general rechaza detalles de una conversación `closed` con mensaje de conversación finalizada; el historial se obtiene mediante mecanismos propios de la empresa. **No alterar estados, borrar historial ni inferir política nueva de archivo.**
- Cualquier habilitación posterior de lectura de histórico cerrado debe pasar la misma autorización por empresa y permiso y requiere pruebas/decisión específica.

### Áreas
- Existen áreas de servicio en el sistema, pero la lectura de `inbox.controller.ts` NO demuestra filtros obligatorios de área para visibilidad general de asesor.
- **No inventar una restricción por área:** inventariar asignaciones y reglas reales antes de decidir su política.

## Hallazgos y corrección autorizada para staging
1. **P0:** `staging-inbox.controller.ts` verificaba usuario y empresa solo con cabeceras y clave compartida, sin firma de sesión. Firmar las dos consultas GET con sujeto, tenant, método y ruta; verificar firma antes de cualquier acceso a datos.
2. **P0:** la lista de staging aceptaba miembros activos sin verificar `inbox.view`; también el diagnóstico Instagram carecía de comprobación de rol/permisos. Consultar rol de empresa y `inbox.view` en DB; preservar lectura compartida por tenant.
3. **P0:** números telefónicos, textos de diagnóstico Instagram y `context` requieren control de autorización antes de devolver datos. No introducir nuevas fuentes de datos ni acciones de escritura.
4. **P1:** el endpoint general de Bandeja tiene un camino bootstrap y múltiples acciones/media fuera del controlador mínimo de staging. Requiere revisión propia antes de producción. No modificado aquí.
5. **P0:** replay con varios servidores sigue bloqueado: mapa de nonces local NO es distribuido. Sin Redis/infraestructura autorizada, solo modo explícito de una réplica y fallo cerrado.

## Alcance de cambio
- **Solo** `GET /inbox` y `GET /inbox/instagram-pilot` de staging + sus proxies web. Identidad Ed25519 desde cookie web verificada; autorización activa de empresa/usuario/membresía/permiso `inbox.view`.
- Sin cambios a `inbox.controller.ts` de producción, transferencias, acciones, mensajes, multimedia, Meta, RLS, sesiones o datos reales.
- Pruebas ficticias Alfa/Beta, propietario/administrador/asesor, revocación, firma alterada, reuso, visibilidad compartida, lectura cerrada sin alteración, y compilaciones web/API.

**Antes de una integración real:** revisión de dependencias SEG-003B/C/D, configuración externa de claves, antirreplay distribuido si hay >1 réplica, pruebas con sesiones reales sintéticas en staging y plan de reversión aprobado.
