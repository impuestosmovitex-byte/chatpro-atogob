# MW1 — Plan de lanzamiento multiempresa (control de alcance)

**Corte:** 21 de octubre de 2026, Bogotá. **Versión:** 1.0 — primera auditoría del alcance, no certificación de producción.

## Definición fija: cuándo podemos lanzar
- **Beta cerrada:** DOS empresas independientes (cada una con sus datos y al menos un número WhatsApp propio), con login, equipo/roles, CRM/bandeja, leads, atención humana, IA controlada, catálogo local Excel/CSV/manual, pedido conversacional cuando esté habilitado, alertas, respaldo, privacidad, soporte y plan comercial definido. **Todas las tareas M01–M26 deben estar cerradas con su criterio de aceptación.**
- **Lanzamiento comercial completo:** Beta aceptada + integraciones reales de Shopify, WooCommerce y Tiendanube + validación de fotos/PDF complejos. **Todas las tareas M01–M30 aprobadas.**
- No confundimos código creado, pruebas unitarias aprobadas, servicios anteriores encendidos, y funcionamiento de la versión actual en Railway.
- **Política de cierre:** "Hecho" significa que el criterio concreto de esa TAREA está comprobado. Una tarea solo marcada en desarrollo, pendiente o bloqueada cuenta **0** en el porcentaje estricto de tareas cerradas.
- **Cambios de alcance:** nuevas ideas después de M30 van al backlog V1.1 salvo vulnerabilidad o defecto P0. Así evitamos mejoras infinitas antes de lanzar.

## Porcentajes verificables

| Hito | Cerradas | Total | Avance estricto |
|---|---:|---:|---:|
| Beta multiempresa | 8 | 26 | 30.8% |
| Lanzamiento completo | 8 | 30 | 26.7% |

**Interpretación:** estos porcentajes miden tareas cerradas de **este plan de lanzamiento**, NO el porcentaje de código construido, calidad global, ni probabilidad de estar listo. Varias funciones están avanzadas técnicamente, pero esperan validación real con dos empresas.

**Estados al corte:** {"Hecho":8,"En desarrollo":11,"Bloqueado":3,"Pendiente":8}.

## Checklist maestro
Actualiza una tarea con `[x]` **solo cuando satisfaga el criterio de aceptación y anota prueba/URL**.

| ✓ | ID | Hito | Área | Prioridad | Estado | Tarea | Criterio de cierre | Evidencia / bloqueo | Dependencia |
|---|---|---|---|---|---|---|---|---|---|
| [x] | M01 | Beta | Base | P0 | Hecho | Rama exclusiva MW1 | Existe rama feature distinta de producción | GitHub ref y CI | Hecho |
| [x] | M02 | Beta | Base | P0 | Hecho | Respaldo del código | Rama backup apuntando al último commit aprobado previo a nuevas mejoras | GitHub backup/mw1-staging-snapshot-20261021 | Hecho |
| [x] | M03 | Beta | Base | P0 | Hecho | Compilación y pruebas automáticas | Web y API compilan; pruebas de seguridad y lógica pasan | GitHub Actions run 39689800142 | Hecho |
| [x] | M04 | Beta | Base | P0 | Hecho | Base aislada para pruebas | Supabase staging independiente con migraciones iniciales verificadas | Supabase staging 16 migraciones registradas | Hecho |
| [x] | M05 | Beta | Catálogo | P1 | Hecho | Lectores básicos Excel, CSV y PDF digital | Validadores y pruebas offline leen archivo con errores claros | CI scripts/test-native-catalog-import.cjs | Hecho |
| [x] | M06 | Beta | IA | P1 | Hecho | Protecciones del carrito por texto | Pruebas automáticas no inventan SKU, dinero ni confirman ventas | CI staging-sales-brain.spec.ts | Hecho |
| [x] | M07 | Beta | IA | P1 | Hecho | Reglas de coincidencia de foto | Pruebas offline evitan elegir variante errónea y requieren confirmación | CI staging-vision.spec.ts | Hecho |
| [x] | M08 | Beta | Catálogo | P1 | Hecho | Interpretación de precios por chat | Tests separan costo/precio y bloquean escrituras en origen externo | CI staging-catalog-admin-command.spec.ts | Hecho |
| [ ] | M09 | Beta | Infraestructura | P0 | Bloqueado | Desplegar código actualizado en Railway staging | Web y API muestran SHA actual y responden pruebas E2E | Railway incidente 21-oct-2026 | Cuando Railway habilite despliegues |
| [ ] | M10 | Beta | Infraestructura | P0 | Bloqueado | Aplicar migraciones nuevas solo a staging | RPC importación enriquecida y cambios de precio, auditoría y rollback validados | SQL migraciones 016/017 solo GitHub | Después M09 y respaldo BD |
| [ ] | M11 | Beta | Seguridad | P0 | Bloqueado | Rotar credenciales tras incidente Railway | Variables y tokens sustituidos; revocaciones y logs revisados | Aviso oficial Railway 21-oct-2026 | Antes de desplegar o conectar canales |
| [ ] | M12 | Beta | Multiempresa | P0 | En desarrollo | Alta de empresa y primer administrador | Crear empresa piloto desde flujo propio sin SQL manual; invitar integrante | Rutas access existentes; onboarding aún no validado | Tras M09 |
| [ ] | M13 | Beta | Multiempresa | P0 | En desarrollo | Inicio de sesión, roles y cambio de empresa | Owner/admin/agente pueden operar solo permisos propios y cambiar de tenant | Código access/login/switch-company revisado | Tras M09 |
| [ ] | M14 | Beta | Multiempresa | P0 | Pendiente | Prueba negativa de aislamiento empresa A/B | Ningún acceso cruzado a chats, clientes, archivos, catálogo, pedidos, IA ni precios | Requiere 2 tenants y pruebas API/browser | Tras M12-M13 |
| [ ] | M15 | Beta | Canales | P0 | En desarrollo | Conectar WhatsApp real por empresa | 2 empresas usan números distintos y reciben/envían sin mezclar datos | Código integraciones presente; no probado E2E en staging | Tras M11 y M14 |
| [ ] | M16 | Beta | CRM | P0 | En desarrollo | Bandeja multicanal y atención humana | Recibir, responder, asignar y cerrar conversación en tenant correcto | Código UnifiedChannelInbox presente | Tras M15 |
| [ ] | M17 | Beta | CRM | P0 | En desarrollo | Contactos, leads y seguimiento | Guardar contacto, crear lead, mover estado y recuperar historial sin fugas | Pantallas/routers presentes; probar flujo real | Tras M16 |
| [ ] | M18 | Beta | IA | P1 | En desarrollo | IA, traspaso a humano y límites | Respuesta con datos del tenant; humano recupera control; errores/costos vigilados | Staging planner + runtime existente, no E2E | Tras M14-M16 |
| [ ] | M19 | Beta | Seguridad | P0 | Pendiente | Seguridad de webhook, medios, reintentos y cuotas | Eventos duplicados idempotentes; rate limits, PII y adjuntos controlados | Revisión técnica y pruebas de penetración ligeras | Tras M15-M18 |
| [ ] | M20 | Beta | Catálogo | P1 | En desarrollo | Importar catálogo local de inicio a fin | CSV/Excel aprobado crea productos, stock, fichas y fotos en staging | Parser probado; RPC 016 pendiente | Tras M10 |
| [ ] | M21 | Beta | Pedidos | P1 | En desarrollo | Pedido conversacional y aviso real controlado | Cliente confirma, stock/precio se validan y estado se visualiza | Código pedidos; probar transacción real staging | Tras M20 |
| [ ] | M22 | Beta | Operaciones | P0 | Pendiente | Backups de BD, restauración, alertas y logs | Restaurar copia en prueba y detectar fallos/envíos duplicados | Sin evidencia de simulacro de recuperación | Antes de pilotos |
| [ ] | M23 | Beta | Catálogo | P1 | En desarrollo | Editar precio local por chat con auditoría | Admin confirma; DB valida precio anterior; se registra actor y cambios | UI y RPC 017 en GitHub, no aplicada | Tras M10 y M14 |
| [ ] | M24 | Beta | Piloto | P0 | Pendiente | Piloto aceptado por 2 empresas independientes | Ambas operan ciclo completo y firman lista sin fallas críticas | Sin pilotos E2E confirmados | Tras M12-M23 |
| [ ] | M25 | Beta | Comercial | P0 | Pendiente | Privacidad, consentimiento, soporte y eliminación de datos | Políticas publicadas, exportar/borrar datos y canal de soporte probados | Pendiente auditoría de operación | Antes de pilotos externos |
| [ ] | M26 | Beta | Comercial | P0 | Pendiente | Planes, límites y cobro beta definido | Precios definidos; habilitar/suspender plan y cobro manual fiable | Página /precios indica Por definir | Antes del primer cobro |
| [ ] | M27 | Público | Conectores | P1 | En desarrollo | Shopify catálogo sincronizado por tienda | Conectar tienda independiente, actualizar variantes y resolver conflictos | Código integraciones Shopify existente, no staging E2E | Después Beta; no implica escritura |
| [ ] | M28 | Público | Conectores | P1 | Pendiente | WooCommerce integrado | Autorización y sincronización de producto, variantes y errores para 2 tenants | Solo tipo de fuente/plan disponible | Después Beta |
| [ ] | M29 | Público | Conectores | P1 | Pendiente | Tiendanube integrada | Autorización y sincronización de catálogo y variantes para 2 tenants | Solo tipo de fuente/plan disponible | Después Beta |
| [ ] | M30 | Público | Visión | P2 | En desarrollo | Fotos reales y PDF escaneado a catálogo | Fotos parecidas y páginas con múltiples productos comparadas contra catálogo real | Vision planner y prueba offline; OCR real no finalizado | Después Beta |

## Schedule por puertas, no por promesas

| Orden | Fase y ventana de trabajo **orientativa** | Actividades críticas | Salida / decisión |
|---|---|---|---|
| Puerta 0 | Ahora, mientras Railway está caído | CI, revisiones, preservar backups, analizar riesgos de seguridad, documentar prueba de tenants | No desplegar ni exponer credenciales |
| Puerta 1 | 1.ª semana de trabajo con Railway restablecido | Rotar secretos; staging actualizado; migraciones pendientes; smoke tests y logs | Staging aislado usable |
| Puerta 2 | 2.ª–3.ª semanas de trabajo | Alta de dos empresas, RBAC y pruebas negativas; WhatsApp por tenant, inbox y contactos | Una conversación entra/sale correctamente por empresa |
| Puerta 3 | 3.ª–4.ª semanas de trabajo | IA/humano, carga de catálogos, pedidos, ajustes de precios, reintentos | Ciclo de atención y venta listo para piloto |
| Puerta 4 | 4.ª–6.ª semanas de trabajo | Restauración BD, alertas, políticas, soporte, precios y piloto de 2 empresas | **GO/NO-GO beta**: todas M01–M26 |
| Puerta 5 | Posterior a beta, duración por validar | Shopify, WooCommerce, Tiendanube, OCR y reconocimiento real | **GO/NO-GO comercial completo**: todas M01–M30 |

Las ventanas son **orden de implementación y estimaciones de esfuerzo**, no fechas garantizadas: la recuperación de Railway, accesos Meta y terceros, personal disponible y hallazgos del piloto pueden modificar el calendario.

## Bloqueadores externos y seguridad

**Railway:** su página oficial reporta el 21 de octubre un incidente mayor con construcciones/despliegues suspendidos; NO tenemos fecha fiable de recuperación.

**Aviso de seguridad Railway del 21-oct-2026:** el proveedor recomienda revocar/rotar variables y claves guardadas, así como revisar logs. Tratar M11 como P0 antes de operar con usuarios reales. No publicar secretos en GitHub o chats.

**Supabase staging:** se observaron 16 migraciones existentes, pero NO constan aplicadas las nuevas migraciones de importación enriquecida y auditoría de precios. No asumir que la confirmación de precios funciona en servidor solo por haber compilado.

**Canales y proveedores:** los archivos de código de integraciones existentes en el repositorio no equivalen a verificación multiempresa en vivo. El módulo API de staging excluye explícitamente integraciones y webhooks reales para mantener aislamiento. Se requiere una integración segura antes del piloto.

## Evidencias técnicas verificadas
- Rama de desarrollo: https://github.com/impuestosmovitex-byte/chatpro-atogob/tree/feature/mw1-saas-staging-20261020
- Respaldo independiente: https://github.com/impuestosmovitex-byte/chatpro-atogob/tree/backup/mw1-staging-snapshot-20261021
- Último CI validado al corte: https://github.com/impuestosmovitex-byte/chatpro-atogob/actions/runs/39689800142 — **64/64 pruebas API** y compilaciones API/web aprobadas; pruebas offline de archivos, selección visual y fuentes.
- Estado oficial Railway: https://status.railway.com/
- Aviso de seguridad: https://blog.railway.com/p/security-disclosure-wednesday-october-21st

## Regla de trabajo a partir de este informe
1. No comenzar nuevas funciones sin asociarlas a M01–M30 o backlog posterior.
2. Elegir el P0 bloqueante más cercano a beta y avanzar una tarea por vez.
3. Al terminar, registrar evidencia, marcarla y **recalcular porcentajes**.
4. Antes de desplegar: verificar rama, entorno, migraciones, secretos y estado del proveedor. **ATOGOB producción no se modifica.**
