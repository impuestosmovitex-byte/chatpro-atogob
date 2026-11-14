# MW1 — Unificación del panel y transición controlada (14 noviembre 2026)

## Alcance y evidencia

Evaluación directa de GitHub (`main`, commit Web productivo `de2926ed`, staging Web `51562857`, staging API `2a7c6dc1`), servicios Railway (solo lectura) y catálogos de tablas de tres Supabase (solo metadatos). Se revisaron componentes y rutas existentes. **No se desplegó ni configuró producción**.

**Decisión de arquitectura**: un único repositorio y experiencia de MW1, sin reemplazar conectores operativos. Staging sigue separado físicamente. No se considera que una URL pública visible o un componente existente equivalgan a un módulo comercial validado de extremo a extremo.

### Inventario Railway existente

| Ámbito | Servicio / procedencia | Uso |
| --- | --- | --- |
| Operativo | `humble-achievement/chatpro-web`, rama `fix/seg002-prod-web-minimal-20261111`, commit `de2926ed` | Interfaz Web productiva actual (dominio `chatpro-web-production.up.railway.app`) |
| Operativo | `humble-achievement/pleasant-trust`, `/apps/api`, commit `371275cb` | API con configuración existente de Meta, Shopify, IA y Supabase; **conservarla** |
| Operativo heredado | `humble-achievement/Chat Pro Inbox Web`, rama `main` | Despliegue Web histórico; verificar uso de tráfico antes de retirar |
| Operativo heredado | `humble-achievement/chatpro-atogob`, rama `main` | Despliegue histórico; **no retirar** sin inventario de webhooks y dependencias |
| Otros existentes | `balanced-freedom/chatpro-atogob` | No se modifica; revisar propietario de ruta antes de cualquier retiro |
| Staging | `mw1-saas-staging/mw1-web-staging`, commit `51562857` | Interfaz nueva propuesta |
| Staging | `mw1-saas-staging/mw1-api-staging`, commit `2a7c6dc1` | API staging con SEG-003B/C/D |
| Staging | `mw1-ai-qa-isolated` | IA QA aislada; no enlazar a credenciales operativas |

Bases existentes: `ynmwgerlfidwsihmzgkw`, `lttucfblydpaljfboxro` (operación histórica) y `zqfbxqszfnrbwpfukwak` (staging). Las dos bases históricas tienen `contacts`, `conversation_sessions`, `conversations`, `company_integrations`, `company_memberships`, `app_profiles`, `automation_executions`. Staging tiene varias tablas SaaS nuevas (planes, consumo IA). **El mapeo exacto de cada tenant real a cada servicio y base debe confirmarse por configuración segura; no inferirlo por nombres**. Nunca copiar datos ni credenciales.

## Comparación funcional

| Función | Panel operativo actual | Nueva interfaz staging | Decisión |
| --- | --- | --- | --- |
| Bandeja y canales WhatsApp/Instagram/Messenger | Componentes `app/page.tsx`, `UnifiedChannelInbox`; operación reportada en ATOGOB/MAOGO | Reutiliza `UnifiedChannelInbox`, listado `GET /api/inbox` protegido; detalle/envío deliberadamente deshabilitados en staging (503) | Reusar bandeja y su API operativa en la transición; probar el contrato sin activar webhooks en staging |
| Clientes y contactos | `/clientes`, `/api/clients`, historial | `/clientes` y GET de solo lectura por rol; escritura e historial restringidos | Mantener contrato existente; no sustituir API real por controlador de solo lectura |
| IA y configuración | `/ia`, `/configuracion/ia`, API actual | Misma ruta más utilidades de IA y catálogo; pruebas no equivalen a conexión real | Reusar identidad, prompts, proveedor y memoria por empresa; cambios opcionales apagados |
| Estadísticas | `/estadisticas`, `/api/statistics` | Conserva ruta firmada con contexto; prueba de acceso a staging | Mantener reporte de cada tenant, sin unir históricos en staging |
| Automatizaciones | `/automatizaciones`, API `/automations` | Interfaz existente, rutas; en staging los flujos salientes reales no están habilitados | Reusar jobs y ejecución operativos; evitar motores en paralelo |
| Roles y usuarios | `/usuarios`, `/usuarios/roles` | Las rutas permanecen; SEG-003 valida permisos e identidad | Misma gestión, condicionada por rol y tenant |
| Integraciones | `/configuracion/integraciones`, Meta/Shopify existentes | Configuraciones y pilotos nuevos; `/api/inbox/channels` devuelve 503 intencional | No reconectar, migrar tokens, cambiar webhooks ni IDs de Meta |
| Leads | Módulo real de MAOGO; `/leads` y `/api/leads` presentes | Rutas heredadas presentes, navegación atada actualmente a slug MAOGO | Conservar MAOGO; futuro permiso `leads.view` por tenant/plan antes de habilitarlo a nuevas empresas |
| Super Admin | Funciones históricas básicas | Panel `/admin`, planes, empresas/propietarios, costos, solicitudes | Reusar para contratación asistida; faltan pruebas de permisos y validación comercial final |
| Pedidos y catálogo | No son requisito del CRM actual | Módulos nuevos `/pedidos`, `/catalogo`, permisos propios | Optativos; no condicionar el CRM base ni habilitar envíos/pagos automáticamente |
| Sitio comercial | `/inicio`, `/precios`, `/demo` | Oferta, formulario y control de solicitudes implementados | Reutilizar; revisar precios, consentimiento y seguimiento hasta alta |
| Mercado Pago | Integración comercial en evolución | Componentes de verificación, plan y panel administrativo | Usar contratación asistida y confirmación verificable cuando se autorice; no pagos reales en staging |

## Integración implementada en rama aislada

Rama: `feature/mw1-unified-workspace-20261114`, partiendo de la Web staging verificada `51562857`.

- `app/panel/page.tsx`: **Centro de operaciones** reutilizable. Valida sesión `/api/auth/session`, derechos `/api/auth/capabilities` y, para comercio opcional, la autorización existente `/api/native-commerce/access`. No consulta bases ni datos de clientes directamente. No inventa APIs ni servicios. Enlaces únicamente a módulos preexistentes.
- `app/panel/page.module.css`: diseño responsivo, tarjetas por bloques (atención, seguimiento, administración, comercio opcional).
- `app/components/AppSidebar.tsx`: acceso a Resumen para usuarios de empresa en escritorio y móvil; no cambia Bandeja por defecto, ni altera roles/canales.
- `.github/workflows/mw1-unified-workspace-validation.yml`: comprobación de TypeScript y compilación Web; NO DEPLOY.

**Estado:** cambios de código en rama aislada, **no están publicados en Railway**. El centro es navegación/experiencia integrada, no evidencia de continuidad de conversaciones reales. La implementación es deliberadamente aditiva y de bajo riesgo.

## Recorrido demostrable (una vez aprobado un despliegue staging)

**Propietario ficticio**: login existente → `/panel` → Bandeja y Clientes (según capacidad) → Estadísticas → Automatizaciones → Configuración → Equipo/roles → Integraciones (consulta) → Mi plan → cambio de empresa autorizado. Comprobar que su información permanece dentro de su empresa y que las funciones opcionales no activan pagos.

**Asesor ficticio**: login existente → `/panel` → Bandeja/Clientes concedidos → conversación asignada y lectura compartida según el contrato del rol → ocultamiento de Equipo/roles, Integraciones y Mi plan. Verificar permisos de API, no solo ocultamiento visual. El detalle de conversación aún está intencionalmente deshabilitado en la API staging, por lo que la prueba completa sigue pendiente.

## Transición futura ATOGOB / MAOGO: plan de reversible sin migrar datos

1. **Inventariar una vez** las rutas verdaderas de acceso y webhooks de cada tenant; revisar empresa-ID, base, servicio de API y worker, nombres de variables (sin extraer secretos), colas y conexión Shopify/Meta. Congelar versiones productivas y backups restaurables.
2. **Contrato API**: identificar diferencias de formato entre el panel operativo y el nuevo en Bandeja, Clientes, IA, Estadísticas y Automatizaciones. Mantener API/colas/conectores productivos como fuente única; los controladores ficticios de staging nunca los reemplazan.
3. **Prueba aislada**: validar con dos tenants ficticios y sesiones de propietario/asesor el panel nuevo, incluidos errores de conexión, roles y sesiones revocadas. Cero credenciales reales; no importar PII.
4. **Compatibilidad plan/tenant**: módulo disponible en código, autorización por rol y plan, habilitación por operador y activación voluntaria son condiciones separadas. Respetar continuidad de pilotos reales sin facturación forzosa.
5. **Aprobación específica de producción**: describir versión exacta, flags por ID de empresa, dominios, reversión, ventana, respaldos y responsables. No modificar DNS, callbacks, webhooks, tokens, números, tablas o conexiones sin ese permiso.
6. **Despliegue aditivo**: colocar versión del panel nuevo al lado del panel antiguo, con ruteo/flag por empresa si está probado. Cambiar **solo la interfaz** del primer tenant; mantener la misma API de operación, registros y webhooks. Verificar mensajes de entrada/salida, IA, humano, plantillas, adjuntos, automatizaciones y estadísticas.
7. **Salida y rollback**: si falla identidad, aislamiento, entrega de mensajes o latencia, volver a la interfaz anterior mediante reversión del flag/ruta. No revertir ni borrar mensajes nuevos, no reconectar Meta ni modificar historiales. Validar segundo tenant solo después del primero.
8. **Retiro diferido**: no apagar servicios históricos hasta tener inventario de tráfico real, observación estable y autorización independiente.

## Flujo comercial mínimo y brechas breves

**Reutilizable:** web Inicio/Precios/Demo, `marketing/demo-request`, cola Super Admin `platform-admin/demo-requests`, alta empresa/propietario, roles, planes/entitlements, `mi-plan`, verificaciones de Mercado Pago, configuración de IA, checklist de activación.

**Pendientes prioritarios**:
1. Aprobar oferta y precios COP, límites por plan y mensajes del sitio; sin prometer canales todavía no verificados.
2. Completar y recorrer el embudo demo → contacto asesor → contratación asistida → pago comprobado en proveedor (sin confiar en captura) → aprobación del operador → alta/plan/propietario → login.
3. Completar guía de incorporación por rol y canal (WhatsApp Meta con permisos propios); no repetir conexiones piloto.
4. Cerrar compatibilidad de Bandeja/historial/envíos y aislamiento autenticado entre dos tenants antes de nuevo cliente productivo.
5. Preparar observabilidad, respaldo, bandera de activación por tenant y rollback de interfaz para pilotos reales.

## Acciones que requieren autorización independiente

- Desplegar esta rama (o integración revisada) en **Web staging** de Railway.
- Cambiar variables, servicios, políticas, roles o datos de staging.
- Habilitar flujos reales Meta, Shopify, Mercado Pago o accesos nuevos.
- Cualquier bandera/ruta/versión de ATOGOB/MAOGO en producción.

Este documento no es autorización de ninguno de esos cambios.
