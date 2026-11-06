# MW1 — dominio comercial y oferta de lanzamiento (23 de octubre de 2026)

## Decisión técnica
MW1 **ya usa** Next.js (web comercial y CRM), NestJS (API), Supabase (datos)
y Railway (hosting/despliegues). No migrar a Shopify o WordPress para
tener un sitio corporativo; duplicaría diseños, usuarios y mantenimiento.

Estado actual: `mw1-web-staging-staging.up.railway.app` es de pruebas.
**No usar el entorno staging de venta pública**. Cuando las pruebas multiempresa
sean satisfactorias, habilitar un ambiente de producción SaaS independiente
de los proyectos operativos de ATOGOB/Emprende con Maogo.

Arquitectura sugerida para primera salida:
- `www.<DOMINIO>` o `<DOMINIO>`: marketing `/inicio`, `/por-que`, `/precios`,
  `/demo`, `/prueba-gratis`.
- En el mismo origen seguro: `/login` → usuarios CRM; `/admin` → plataforma.
  Evitar introducir otro origen para las cookies de acceso hasta verificar
  SSO, dominios de cookie y aislamiento.
- Futuro opcional: `app.<DOMINIO>` para CRM y `api.<DOMINIO>`
  únicamente cuando exista un diseño de seguridad auditado. No publicar
  una API interna de servicios por conveniencia.

## Compra y configuración
1. Buscar el nombre disponible y registrar el dominio a nombre de la sociedad
   titular de MW1, con renovación automática, doble factor y administrador
   separado del operador técnico.
2. Elegir registrador/DNS (Cloudflare o un registrador acreditado).
3. Crear la web y API en entorno SaaS producción **independiente**; probar
   autenticación, permisos, integraciones, alertas y secretos.
4. En Railway, Web service → Settings → Networking → Public Networking →
   `+ Custom Domain`, introducir el dominio elegido.
5. Configurar **exactamente** el `CNAME` y `TXT` entregados por Railway
   en el DNS del registrador; para dominio raíz, CNAME flattening/ALIAS
   según proveedor. No inventar valores ni utilizar IPs fijas.
6. Verificar certificado HTTPS, dominio, callback URLs, cookies de sesión,
   OAuth Meta, CORS/Origin para formularios, correo de empresa, SEO y los
   enlaces externos de inicio de sesión.
7. Probar con navegación anónima y sesiones de diferentes empresas antes
   de promocionarlo. Mantener staging sin indexar.

Guía del proveedor: https://docs.railway.com/networking/domains/working-with-domains

## Política comercial a decidir — NO PUBLICADA
**Alternativa A (vigente en staging):** prueba de 14 días guiada, sin cobro
ni activación automática, solo después de confirmar acceso y canal.
Costo comercial: la instalación completa podría no convertirse en pago.

**Alternativa B (recomendada para adquisición asistida):**
el cliente contrata y paga el primer ciclo de un mes, después de confirmar
viabilidad técnica y forma de conectar WhatsApp. Durante el segundo ciclo
mensual, una promoción de lanzamiento del 50% se aplica **una sola vez**,
si la suscripción sigue activa. Luego, tarifa completa.

Valores de ejemplo según precios comerciales actualmente propuestos:
- Básico: primer mes 149.000 COP; segundo mes 74.500 COP.
- Eco: primer mes 259.000 COP; segundo mes 129.500 COP.
- Pro: primer mes 599.000 COP; segundo mes 299.500 COP.

**No llamar a este descuento “14 días gratis”**: un descuento del 50 %
del segundo ciclo no coincide necesariamente con 14 días naturales.
Tampoco se deben prometer ni mostrar ambos incentivos acumulativos.
Decidir si sustituye o coexiste por segmentos, aprobación de condiciones,
topes de soporte e inscripción, facturación y cancelación.

El inicio del primer ciclo debe comunicarse claramente antes de cobrar.
Se necesita mecanismo verificable para confirmar pagos y registrar
fechas; hoy no existe activación automática de suscripciones.
Nunca cobrar por este formulario sin autorización ni alterar
entitlements de ATOGOB/Emprende con Maogo.
