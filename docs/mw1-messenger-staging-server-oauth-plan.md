# MW1 — Messenger OAuth en staging: diseño y límites

Estado: **diseño y validación local**, todavía NO es una integración funcional.

## Propósito
Sustituir el flujo heredado de ChatPro, que devuelve tokens de Meta al navegador,
por un flujo de Messenger íntegramente gestionado por el servidor y aislado por empresa.

## Reglas obligatorias
1. Staging exclusivamente: `mw1-web-staging-staging.up.railway.app` y API correspondiente.
   No tocar WhatsApp o proyectos de producción.
2. Sesión autenticada con rol owner/admin y pertenencia real a la empresa piloto
   `piloto-mw1-prueba`, verificada también en la API.
3. Estado OAuth firmado, de un único uso y con caducidad; asociarlo a usuario
   y empresa en base de datos (no confiar solo en sessionStorage).
4. Callback con origen de staging fijo. Rechazar estados inválidos, duplicados,
   vencidos o reutilizados. No reflejar códigos en la URL de la página.
5. Exchange de código y validación de `app_id` y permisos exclusivamente en API
   backend. Las credenciales/tokens NUNCA se devuelven al navegador.
6. Permisos por confirmar con Meta: `pages_show_list`, `pages_messaging`,
   `pages_manage_metadata`. La versión de Graph y los permisos definitivos
   deben validarse con la configuración Meta de la app antes de conectar.
7. Obtener y verificar las páginas autorizadas en el servidor. El operador
   elige la página por ID sin recibir el token. Comprobar que pertenece a
   los activos concedidos y que no está vinculada a otra empresa.
8. Cifrar el token de página con `IntegrationCredentialsService` y guardar
   en `company_integrations` como `pending`, con
   `webhooks_subscribed=false` y `messaging_enabled=false`.
   Respetar el índice único por provider/integration_type/external_id;
   nunca sobrescribir credenciales de otra empresa.
9. No llamar a `/{page-id}/subscribed_apps`, no configurar webhooks,
   no enviar ni procesar mensajes durante OAuth.
10. Auditar los resultados y fallos sin registrar códigos ni tokens.

## Estado técnico al elaborar este plan
- La UI y las rutas heredadas Messenger siguen **bloqueadas en staging**;
  `app/lib/staging-messenger-gate.ts` lo impone.
- Nuevo contrato de validación local:
  `apps/api/src/staging-messenger-authorization-policy.ts`, sin acceso a
  red, Meta, base de datos ni tráfico de usuarios.
- Pruebas sintéticas Jest aseguran permisos, empresa/usuario, selección de página,
  no-duplicación, cifrado, estado `pending` y webhooks apagados.
- No se crearon variables nuevas ni se activó la conexión real.

## Próxima implementación (NO realizada aquí)
- Diseñar el estado OAuth de Messenger con almacenamiento de nonces separado.
- Endpoints backend de begin, callback e intercambio server-to-server,
  sujetos a autorización explícita y seguridad revisada.
- Confirmar en Meta configuración de Messenger, permisos, callback,
  token de página, expiración y derechos del titular.
- Guardar `pending` solo después de comprobar Meta y propiedad de la página.
- Probar el flujo con cuenta/página de ensayo, sin activar mensajería.
- Únicamente después, desarrollar webhooks y mensajería bajo otra revisión.

## Criterio de aprobación
Pruebas automatizadas verdes, ningún token en payloads de navegador,
ninguna cuenta activa, ninguna suscripción webhook, ninguna empresa de producción
afectada y prueba real autorizada cuando corresponda.
