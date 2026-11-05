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
- Protocolo interno de OAuth firmado y validación del callback:
  `app/lib/staging-messenger-oauth-protocol.ts`. Comprueba rol y empresa
  piloto, nonce aleatorio, HMAC, expiración, cookie concordante y parámetros
  ambiguos. **No está conectado a rutas públicas y no impide reutilización por
  sí solo**. Requiere una clave independiente `MW1_MESSENGER_OAUTH_STATE_SECRET`
  únicamente cuando se implemente el flujo autorizado; no crear ni activar
  variables ahora.
- **Supabase staging preparado (5 nov 2026)**. Migración aplicada:
  `20261105054129_mw1_staging_messenger_oauth_nonce_isolation`.
  Tabla exclusiva `public.mw1_messenger_oauth_nonces` con nonce SHA-256 único,
  empresa y usuario, vencimiento máximo de 10 minutos, marca `consumed_at`,
  índice de expiración y RLS activo. Sin políticas públicas: `anon` y
  `authenticated` no tienen acceso. Solo el rol del servidor puede guardar
  y consumir registros.
- La función `public.mw1_consume_messenger_oauth_nonce(text,uuid,uuid)`
  realiza consumo atómico y comprueba empresa, usuario, no consumido y no
  vencido. Usa `SECURITY INVOKER` y `search_path` restringido.
- Nuevo adaptador interno de API `apps/api/src/staging-messenger-oauth-nonce-store.ts`:
  prepara el vencimiento en el servidor (9 minutos), valida empresa/usuario
  del piloto y hash SHA-256, guarda exclusivamente el hash y consume una sola
  vez mediante la función SQL anterior. Se agregaron pruebas Jest con cliente
  Supabase simulado para registro, rechazo por empresa/usuario, errores de
  escritura y consumo de nonce reutilizado o inválido.
  **No se registró en AppModule ni se expuso por endpoints**: la capa futura
  todavía deberá comprobar la sesión y los permisos en la API antes de llamar
  este adaptador. No existen llamadas Meta ni manejo de tokens reales.
- **Verificación adicional implementada** en
  `apps/api/src/staging-messenger-oauth-authorized-nonce.service.ts`:
  antes de usar el adaptador, exige clave de servicio interno, fija el destino
  a Supabase STAGING, comprueba empresa activa por ID y slug, membresía activa
  del usuario y rol `owner/admin` (global o de esa empresa). Revalida en
  cada registro y consumo, para rechazar membresías revocadas. Pruebas con
  Supabase simulado cubren credencial interna incorrecta, otra empresa,
  usuario sin membresía, rol insuficiente, fallos de lectura y cambio de
  proyecto. **Sigue sin registrarse en AppModule ni exponerse como ruta pública.**
  Prueba transaccional aprobada: empresa equivocada, usuario equivocado,
  reutilización, autorización caducada y nonce inexistente rechazados;
  un nonce válido solo se consume una vez. La transacción se revirtió y
  quedaron **0 registros persistentes**.
- Supabase Advisor muestra el hallazgo informativo `rls_enabled_no_policy`
  sobre esta tabla. Es intencional: acceso cerrado para clientes públicos;
  no crear una política permisiva para eliminar el aviso.
- Pruebas sintéticas Jest aseguran permisos, empresa/usuario, selección de página,
  no-duplicación, cifrado, estado `pending` y webhooks apagados.
- No se crearon variables nuevas ni se activó la conexión real.

## Próxima implementación (NO realizada aquí)
- Integrar el registro y consumo atómico de nonces ya creado en Supabase
  staging con endpoints de servidor seguros, **solo cuando se autorice el piloto**.
  La existencia de la tabla no habilita OAuth ni reemplaza la validación de Meta.
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
