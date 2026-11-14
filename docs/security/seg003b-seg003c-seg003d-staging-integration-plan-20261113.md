# MW1 — Plan de integración SEG-003B + SEG-003C + SEG-003D
**Estado:** propuesta para aprobación; NO AUTORIZA despliegues, migraciones, configuración de claves ni fusiones.

## Dependencias verificadas
- **API:** PR #36 (base SEG-003B) → PR #38 (SEG-003C, base #36) → PR #40 (SEG-003D Clientes, base #38) → PR #42 (SEG-003D Bandeja, base #40).
- **Web:** PR #37 (base SEG-003B) → PR #39 (SEG-003C, base #37) → PR #41 (SEG-003D Clientes, base #39) → PR #43 (SEG-003D Bandeja, base #41).
- No sustituir los avances existentes de ninguna cadena. Revisar diferencias y conflictos de cada PR antes de preparar un paquete de staging.

## Fase 0 — Puerta previa de seguridad, sin despliegue
1. Confirmar revisiones de diffs y permisos por archivo para todos los PR. Asegurar que los dos conjuntos API/web fueron probados con los SHAs que se pretende integrar.
2. Resolver el bloqueo **P0** de replay en múltiples réplicas: verificador actual requiere `MW1_INTERNAL_SINGLE_REPLICA_ACK=true` y `MW1_INTERNAL_REPLICA_COUNT=1` pero es **memoria local**, no un almacén distribuido. Solicitar decisión específica: diseño Redis SET NX con TTL si se desea escalado; no configurar infraestructura ahora.
3. Obtener aprobación independiente para provisión de clave privada Ed25519 solo web, clave pública solo API, y manejo seguro de secretos/rotación (nunca en GitHub).
4. Inventariar endpoints no incluidos en staging de solo lectura, en especial módulo general `inbox.controller.ts`, rutas multimedia, webhooks y `access-capabilities`. No extender este paquete a producción.
5. Confirmar procedimiento de restauración de staging, responsables, puntos de control y criterios de cancelación.

## Fase 1 — Solo con nueva autorización: staging integrado
1. Establecer ventanas de pruebas con servicios aislados; realizar copia de configuración y plan de reversión.
2. Desplegar simultáneamente API/web compatibles (con claves seguras) para evitar firmas enviadas a un backend desfasado o verificador rechazando llamadas antiguas.
3. Validar inicio de sesión sin modificarlo, sesiones firmadas vigentes, superadmin, cambio entre empresas, propietarios, admins y asesores.
4. Ejecutar pruebas Alfa/Beta con datos **ficticios**: revocar membresía/perfil en entorno aislado, intentar identificadores ajenos, manipular filtros y recursos, reusar firmas, verificar restricción de base de datos.
5. Revisar Clientes GET listado/perfil con `clients.view` y asignación; Bandeja GET lista y diagnóstico Instagram con `inbox.view` preservando visibilidad compartida.
6. Confirmar que `POST /api/clients`, acciones de Bandeja, integraciones de Meta, Shopify y Mercado Pago **no** fueron modificados por SEG-003D. No iniciar cobros reales ni envíos reales.
7. Validar salud de servicios y trazas de autorización; obtener resultados reproducibles, sin datos privados en logs.

## Fase 2 — Decisión del supervisor
- **APROBAR** solo si todos los controles anteriores funcionan en staging.
- **BLOQUEAR/REVERTIR** ante errores de inicio de sesión, fallos de aislamiento, incompatibilidad de firmas, capacidades de roles degradadas o exposición de contactos/archivos.
- Nunca promover a producción automáticamente. Producción y RLS requieren auditoría y autorizaciones propias.

## Política de Bandeja preservada
- `inbox.view` para lectura compartida entre usuarios activos del mismo tenant; propietario/admin no cambian el aislamiento.
- Asignación y `inbox.reply` controlan gestión, no visibilidad general.
- `inbox.take`, `inbox.take_ai`, `inbox.take_waiting`, `inbox.take_all` y opciones de IA mantienen sus reglas existentes.
- Áreas: sin política inferida; revisar separadamente.
- Conversaciones `closed`: staging puede listar metadatos sin alterar historial; el controlador general sigue rechazando GET de detalle cerrado. Cualquier mejora del archivo requiere nueva decisión.

**Bloqueo permanente:** resultados sintéticos y compilaciones correctas no son autorización de despliegue ni certificación de seguridad final.
