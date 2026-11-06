# MW1 — Unificación segura de staging con operación actual

## Principio innegociable
MW1 es un CRM multiempresa. ATOGOB y Emprende con Maogo son clientes, no plataformas distintas. La producción actual (Railway branch `main`) es la referencia operativa; las nuevas funciones comerciales están en `feature/mw1-saas-staging-20261020`.

**No fusionar, desplegar en producción, copiar claves, cambiar webhooks de Meta, crear clientes duplicados, mover credenciales, ni apuntar staging a Supabase producción como atajo.**

## Comparación inicial (25 oct 2026)
GitHub compare `main...feature/mw1-saas-staging-20261020`: rama ahead por **644 commits**, cambios en **231 archivos**. Contiene modificaciones en autenticación, API, inbox, integraciones, panel global y facturación. Esta cifra es una fotografía, no una métrica de progreso o aprobación.

## Lanzamiento comercial: camino crítico
1. Portal público: Inicio → Precios → solicitud de demostración; asesor acuerda cita.
2. Venta asistida: verificar manualmente el primer pago contra Mercado Pago, **no** solo con captura.
3. Alta desde superadministrador: empresa separada, propietario, roles, plan, cupos y acceso.
4. Propietario conecta sus propios canales usando la autorización de Meta; nunca compartir tokens por chats.
5. Recibir y contestar mensaje real; comprobar IA, traspaso humano, plantilla y automatización.
6. Verificar que otra empresa no accede a conversaciones, contactos, medios, catálogos, tokens ni estadísticas de ATOGOB.
7. Solo entonces actualizar el despliegue comercial; renovaciones automáticas pueden seguir deshabilitadas.

## Puertas de liberación (todas obligatorias)
- [ ] Backups restaurables y procedimiento de reversión probado **sin borrar datos nuevos**.
- [ ] Tests automáticos y build de web/API exitosos con evidencia de ejecución, no solamente commits.
- [ ] Inicio de sesión válido para propietario, bloqueo de inactivo y aislamiento de superadmin.
- [ ] Validación del aislamiento entre al menos dos empresas diferentes.
- [ ] Conexión de un canal de una empresa piloto nueva sin reutilizar credenciales ATOGOB.
- [ ] Webhooks entrantes y salientes siguen llegando a su empresa correcta.
- [ ] Prueba de mensajes: recepción, respuesta de IA, transferencia y automatización.
- [ ] Planes/cuotas y solicitud de demo se comportan como oferta comercial aprobada.
- [ ] Revisión de diferencias de esquema y variables Railway/Supabase; secretos nunca en commits.
- [ ] Ventana de publicación y plan de reversión aprobados por responsable.

## Estrategia de integración
1. Congelar una referencia del código `main` actual y registrar rutas/servicios vigentes.
2. Evaluar archivos críticos de manera diferencial, priorizando paridad de conversaciones e integraciones.
3. Preparar cambios en rama temporal derivada de `main` para portarlos por bloques; no sustituir `main` por toda staging.
4. Probar esos cambios contra un entorno aislado con usuarios y credenciales exclusivamente de prueba.
5. Promover las funciones probadas de marketing, superadmin y onboarding; no trasladar cuentas a mano.
6. Desplegar con reversión disponible y monitorear la continuidad de ATOGOB.

## Estado conocido
- Staging presenta ATOGOB/Emprende con Maogo como referencias **de solo lectura** mediante `platform_external_tenant_registry`. NO equivale a administración remota en tiempo real.
- La sesión de ATOGOB productiva no autentica automáticamente en la base separada de staging.
- Aún no hay prueba completa de segunda empresa con WhatsApp, IA y automatización.
- Integración de renovaciones de Mercado Pago no bloquea la venta asistida inicial.
