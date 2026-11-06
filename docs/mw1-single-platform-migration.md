# MW1 — Arquitectura única y migración segura (2026-11-01)

## Decisión de producto
MW1 es el **único producto** CRM y comercio conversacional. «Chat Pro» es únicamente
el nombre histórico de los despliegues existentes y del repositorio; no se sigue
desarrollando como plataforma separada.

## Una sola fuente de código
- Repositorio actual: `impuestosmovitex-byte/chatpro-atogob`.
- `feature/mw1-saas-staging-20261020`: integración y validación antes de publicar.
- `main`: operación en producción mientras dure la transición; nunca introducir
  funcionalidades por separado en esta rama.
- Toda funcionalidad y corrección se desarrolla **una vez**, se valida en staging y
  se promueve por PR revisado a producción en una versión identificable.

## Entornos, no productos
- **MW1 staging:** Railway `mw1-saas-staging`, servicios web y API;
  Supabase `zqfbxqszfnrbwpfukwak`. Solo pruebas y datos de prueba.
- **Operación actual de ATOGOB y MAOGO:** servicios Railway históricos sobre
  `main`; bases de datos existentes `ynmwgerlfidwsihmzgkw` y
  `lttucfblydpaljfboxro`. No modificar sin migración auditada.
- **MW1 producción (objetivo):** un solo acceso comercial, con tenants aislados,
  roles, inbox y conexiones activas; puede seguir usando varios servicios técnicos
  internos (web/API/worker) y un entorno staging independiente.
- No renombrar, borrar, desconectar o fusionar entornos existentes antes de
  verificar configuración y conectores de ATOGOB y MAOGO.

## Ruta de transición (sin detener ventas)
1. Inventariar servicios, dominios, secretos por nombre, conexiones Meta,
   Shopify, tenants, roles, bases de datos, webhooks y fuentes de verdad.
2. Comparar funciones actuales con MW1 staging: inbox, plantillas, estados
   sent/delivered/read/failed, medios, catálogos, pedidos, usuarios y alertas.
3. Cerrar brechas en la rama única; cada hotfix pasa por la misma revisión.
   Las modificaciones del antiguo servicio son solo un destino de despliegue
   hasta finalizar la migración.
4. Preparar migraciones reproducibles y reversibles (esquema/datos) y validar
   relaciones multiempresa, claves, mensajes históricos y permisos.
5. Probar en entorno piloto: WhatsApp/IG/Messenger, audio/foto/video,
   plantillas y acuses Meta, roles, IA, comercio y seguridad.
6. Publicar versión MW1 en producción con copia de respaldo, ventana
   controlada, rollback definido, health checks y monitoreo.
7. Transferir accesos/rutas/webhooks sin duplicar procesamientos; comprobar
   clientes actuales y nuevas entradas antes de desactivar servicios históricos.
8. Solo cuando ATOGOB y MAOGO funcionen en MW1 producción, retirar nombres
   y despliegues antiguos. No borrar mensajes ni conexiones activas.

## Reglas de seguridad
- Nunca probar nuevas credenciales Meta o cobros reales contra tenants
  productivos sin consentimiento y validación específica.
- Webhooks con verificación auténtica, idempotencia y aislamiento por tenant.
- Los estados «solicitado/enviado a Meta» y «entregado» no son equivalentes.
- Para mensajes fallidos (p. ej. 131049), mostrar advertencia y tarea para
  contactar por vía autorizada; NO reintentar automáticamente marketing.
- Pruebas y cambios de pagos se mantienen desactivados hasta reconciliación
  de proveedor y ensayos completos.
- Despliegue irreversible o sin retorno: prohibido sin plan de respaldo.

## Criterios para dar por terminada la unificación
- ATOGOB y MAOGO acceden a la misma aplicación MW1 (tenants separados).
- Las mismas funciones y correcciones se aplican a todos los tenants,
  sujetas a permisos y planes; sin duplicar código por marca.
- Una sola secuencia de versiones: staging -> revisión -> producción.
- Pruebas verificadas de mensajes y estados, roles, migración histórica,
  conectores, pedidos y recuperación ante errores.
- Servicios antiguos retirados solo después de validar que ya no son necesarios.

## Decisión explícita: conexiones heredadas ATOGOB y Emprende con MAOGO
- Las conexiones actuales de WhatsApp, Instagram, Messenger y demás integraciones
  de ATOGOB y Emprende con MAOGO **se conservan tal como funcionan hoy**,
  incluso si su alta fue manual o anterior al onboarding automatizado de MW1.
- No revocar tokens, desconectar números, reemplazar webhooks, cambiar IDs de
  Meta ni exigir reconexión durante el desarrollo o la migración por defecto.
- MW1 debe admitir conexiones **legacy/manual** y conexiones **onboarding
  automatizado** como modalidades compatibles de la misma plataforma multiempresa.
- Antes de cualquier cambio sobre conectores heredados, inventariar IDs,
  permisos, suscripciones webhooks, tenencia por empresa y rutas de mensajes;
  validar en staging sin producir eventos duplicados.
- Después de consolidar MW1 y verificar continuidad, evaluar **por separado**
  si conviene migrar cada cuenta al flujo automatizado; solo hacerlo si es
  realmente necesario, con autorización explícita, respaldos y plan de reversión.
- Los nuevos clientes sí podrán utilizar el flujo automatizado de conexión
  cuando esté probado y habilitado.

## Decisión comercial y operativa: pilotos, medición y activación de funciones
- **ATOGOB y Emprende con MAOGO** son empresas reales piloto dentro del futuro
  MW1 unificado. Deben tener acceso operativo continuo **sin bloquearse** por
  ausencia de plan contratado, tarjeta, autorización de cobro, suscripción o
  cupos comerciales durante la etapa piloto.
- Esto **NO** implica ignorar la autenticación, las autorizaciones de usuario,
  la seguridad ni los límites técnicos de los proveedores.
- Sus conexiones manuales heredadas permanecen intactas. Ninguna acción de
  onboarding automatizado debe revocar sus credenciales ni duplicar webhooks.
- La exención piloto y sus fechas/cambios serán propiedad del superadministrador;
  las empresas de prueba no obtienen esa condición por coincidencia de nombre.
  Validar siempre por ID de tenant, no por el texto del nombre o el slug.
- El consumo se mide aun cuando el cobro esté exento: llamadas de IA,
  modelo/tokens/costo estimado, mensajes WhatsApp por categoría/estado,
  almacenamiento, adjuntos, automatizaciones, infraestructura asignable y
  otros servicios medibles.
- Un estimado de costos **no equivale** a un cargo facturado: registrar fuente,
  fecha, unidad, tarifas efectivas, moneda, confianza y limitaciones. Los costos
  compartidos se asignan con metodología explícita; no inventar un monto por
  cliente sin datos.
- Separar **(a) disponibilidad de código**, **(b) derecho por plan o excepción**,
  **(c) habilitación por superadministrador** y **(d) activación/configuración
  voluntaria por la empresa**. Una actualización jamás debe activar de forma
  sorpresiva pagos, automatizaciones, conexiones o IA nueva.
- Matriz por empresa: disponible / permitido por plan / habilitado por
  plataforma / configurado por empresa / operativo / consumo.
- El superadministrador podrá encender o apagar módulos por tenant, con
  auditoría, sin cambiar por error planes, cobros o datos históricos.
- En el piloto ATOGOB/MAOGO, el control de funciones no debe poner en peligro
  el uso vigente; novedades opcionales quedan inicialmente apagadas.
- Ante eventual plan Básico, Eco, Pro, límites/medios de pago se aplicarán
  solo a empresas y módulos sujetos a contratación; jamás convertir el
  estado 'sin medio de pago' en un bloqueo universal de los pilotos.
- Nombre comercial **provisional**: MW1; se evaluará «Chatbo MW1» u otra
  marca. Un cambio de marca nunca obliga a reconectar canales.
- Las mejoras aprobadas se desarrollan una vez en la rama MW1, se prueban
  en staging y se promueven por versión a la operación de todas las empresas;
  la activación se gestiona por tenant. No mantener dos productos.
- Situación comprobada el 2026-11-01: staging tiene
  `company_entitlements`, `mw1_billing_subscriptions` y
  `platform_ai_usage_events`; esta última está vacía. Las empresas de
  operación ATOGOB/MAOGO aún no están migradas a esa base staging.
  No presentar el costo estimado de staging como consumo real productivo.
