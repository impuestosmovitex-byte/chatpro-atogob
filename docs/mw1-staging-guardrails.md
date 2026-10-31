# MW1 — entorno de desarrollo aislado (20/10/2026)

## Objetivo
Desarrollar MW1 como SaaS multiempresa, modular (CRM, CRM+IA, Comercio/Pedidos), manteniendo intacta la operación de ATOGOB.

## Recursos separados
- Rama de trabajo: `feature/mw1-saas-staging-20261020` (base `main`).
- Proyecto Railway privado: `mw1-saas-staging` (`4cc3fcfb-a07e-42d4-9dd3-28ae80b4dc91`).
- Entorno Railway: `staging` (`119d67ce-a983-4215-98cd-84ffc6c8ec47`).
- Servicios diseñados (SOLO staged; sin desplegar): `mw1-api-staging` y `mw1-web-staging`.

## Reglas obligatorias: NO modificar producción
1. Nunca conectar staging a Supabase de producción, bases de datos, buckets, API keys, webhooks, WhatsApp, Instagram, Shopify, credenciales de pago o canales reales de ATOGOB.
2. Usar una instancia de base de datos de pruebas independiente, con esquema versionado y datos sintéticos o anonimizados. La ausencia de una base independiente bloquea cualquier despliegue de la aplicación.
3. Prohibido usar tokens reales de Meta, WhatsApp o pagos; utilizar sandbox, dobles de prueba o números separados.
4. Rama `main` y Railway del proyecto de producción no deben tocarse durante este trabajo. Ningún merge o despliegue automático de staging hacia producción.
5. No activar envíos, automatizaciones, webhooks ni cobros reales en staging. Los procesos con efectos externos requieren un modo explícito de prueba y denylist de destinatarios externos.
6. Antes de cada cambio de producción: respaldos recuperables; migraciones reversibles o plan de recuperación; aprobación expresa; pruebas de regresión con ATOGOB; plan de rollback documentado.
7. Nunca almacenar contraseñas, tokens o claves en el repositorio.

## Primeras verificaciones
- [x] Rama independiente creada a partir de `main`.
- [x] Proyecto Railway privado separado con PR deploys deshabilitados.
- [x] Entorno `staging` existente.
- [x] API y web preparadas en cambios staged, no aplicados.
- [ ] Crear/obtener Supabase de pruebas completamente independiente (requiere acceso y configuración).
- [ ] Conectar SOLO credenciales de sandbox y variables de entorno de staging.
- [ ] Verificar que API y web no tengan ninguna ruta a recursos de ATOGOB.
- [ ] Desplegar en staging únicamente después de superar revisión de variables, endpoints y fuentes externas.
- [ ] Ejecutar pruebas end-to-end con empresa y contactos ficticios.
- [ ] Revisión de aislamiento por `company_id`, seguridad y permisos.
- [ ] Probar que ATOGOB permanece sin cambios (mensajes, pedidos Shopify, IA y automatizaciones).

## Diseño inicial de producto
- Plan 1: CRM (bandeja multicanal, usuarios, clientes, áreas y permisos).
- Plan 2: CRM + IA (agente configurable de ventas y servicio, fuentes de conocimiento).
- Plan 3: MW1 Comercio (catálogo propio/PDF/CSV, carrito, pedidos nativos, enlace de pago, confirmación por proveedor, preparación y despacho).
- Complementos: usuarios, líneas adicionales, consumo de IA/mensajería, canales.
- Distinguir subscripciones pagadas a MW1 de los pagos de consumidores a comercios.
- Migración de pedidos nativos: no modificar el checkout Shopify de ATOGOB; nuevo proveedor `native` para comercios sin e-commerce.

## Criterios técnicos previos al lanzamiento
1. Aislamiento comprobado de empresas/recursos incluso ante company_id manipulado.
2. Idempotencia en mensajes, pagos, pedidos y descuentos de inventario.
3. Confirmaciones de pagos solo después de webhook autenticado y verificación de transacción.
4. Registro de eventos, alertas, auditoría y política de retención de datos.
5. Pruebas de regresión en flujos existentes de ATOGOB y pruebas de carga.
6. Activación de módulos por empresa mediante feature flags/entitlements en backend.

**Estado:** infraestructura de preparación creada. Aún NO es un entorno ejecutable: faltan base de datos y credenciales aisladas, configuración de fuentes y despliegue validado.
