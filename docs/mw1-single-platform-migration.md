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
