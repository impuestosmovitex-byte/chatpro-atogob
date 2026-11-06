# MW1 — piloto de coexistencia WhatsApp Business App + Cloud API

Fecha de verificación: 2026-11-06. Alcance exclusivo: `piloto-mw1-prueba` en Railway/Supabase staging.

## Confirmado en entorno de pruebas
- Sesión del propietario/administrador del piloto, inicio web→API y emisión de autorización temporal de un solo uso: comprobados con el número piloto todavía sin conectar a Cloud API.
- En Railway, las banderas `MW1_STAGING_WHATSAPP_COEXISTENCE_OAUTH_BEGIN_ENABLED` están presentes. La apertura de Meta y su revisión permanecen inhabilitadas.
- La tabla `mw1_whatsapp_coexistence_business_bindings` tiene **0** asociaciones: no se ha verificado titularidad ni conectado ningún número a MW1.
- ATOGOB y MAOGO deben permanecer fuera del piloto.

## Bloqueadores reales (no confundir con errores del botón)
1. La solicitud de revisión de Meta todavía figura **No enviada** para `whatsapp_business_messaging` y `whatsapp_business_management`. Faltan videos genuinos de funcionamiento y confirmaciones de uso permitido; no afirmar acceso avanzado mientras no haya evidencia de aprobación.
2. Comprobar en Meta que el `META_WHATSAPP_EMBEDDED_CONFIG_ID` corresponda a un flujo de **WhatsApp Business App coexistence**, no únicamente registro convencional. El código emplea `extras.featureType='whatsapp_business_app_onboarding'`; este parámetro no acredita por sí mismo que el Builder de Meta habilite coexistencia.
3. El servicio `StagingWhatsappCoexistenceTenantVerificationService.verify()` exige una asociación de titularidad temporal y verificada, pero el flujo actual **no tiene un escritor de esa asociación autorizado tras OAuth**. El retorno puede rechazar un flujo real incluso con token, número y permiso válidos.
4. El estado de revisión de Meta y los permisos avanzados **no pueden deducirse** de la presencia de App ID/App Secret o de variables en Railway.

## Próxima implementación (requiere revisión antes de habilitar banderas)
- Diseñar el registro de asociación temporal únicamente después de completar un OAuth legítimo del piloto: sesión firmada, permiso/grant de la WABA, consulta a Graph API de `owner_business.id`, comprobación de coexistencia `is_on_biz_app=true` y de inexistencia de una integración del teléfono; guardar solo IDs verificadas, empresa, usuario, onboarding_id y vencimiento breve. No aceptar un `business_id` enviado por el navegador como prueba de titularidad.
- Agregar pruebas negativas: empresa/usuario diferente, WABA sin grant, Business ID diferente, número convencional, número ya asignado, estado vencido y reuso del código.
- Grabar evidencia real para Meta solo cuando el piloto pueda completar un flujo autorizado; no fabricar ni simular funciones como si estuvieran operativas.
- Mantener conexión/credenciales persistentes, webhooks, envío de mensajes y sincronización de historial deshabilitados hasta decisión de activación aislada y consentimiento explícito.
- Tras verificar la configuración y permisos de Meta, habilitar `META_LAUNCH` y `META_REVIEW` por separado y probar exclusivamente la SIM piloto, con posibilidad de revertir de inmediato.

## Seguridad
No modificar producción, cuentas/automatizaciones/mensajes de ATOGOB o MAOGO; no compartir credenciales, códigos temporales ni tokens en capturas o bitácoras.
