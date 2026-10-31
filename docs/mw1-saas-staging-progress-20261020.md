# MW1 — Informe de avance seguro, 20 de octubre de 2026

**Estado de la entrega:** desarrollo en rama `feature/mw1-saas-staging-20261020`; Supabase de pruebas `zqfbxqszfnrbwpfukwak`. Railway independiente `mw1-saas-staging`: cambios STAGED, SIN desplegar.

## Implementado
- CRM mínimo: empresas, perfiles, membresías, permisos, conversaciones y configuración en esquema staging.
- Comercio nativo: fuentes de catálogo, productos, variantes, inventario, carritos, artículos, pedidos, pagos, guías y eventos.
- Función `mw1_commerce_transition_order`: cambios de estado atómicos con validación de empresa, plan y rol; NO marca órdenes pagadas.
- Función `mw1_commerce_create_manual_product`: alta de producto y variante con verificación de rol, permisos, límites, SKU, precio y stock.
- Nest `native-commerce.controller.ts`: endpoints protegidos `/native-commerce/access`, `/native-commerce/orders`, `/native-commerce/products`, detalle y cambio de estado.
- Proxy Next.js `/api/native-commerce/**`: autenticación mediante cookie de sesión firmada e identidad de usuario/empresa resuelta en servidor.
- Interfaz web `/catalogo`: formulario de productos y listado.
- Interfaz web `/pedidos`: cola de pedidos, detalle y estados operativos.
- Seguridad: arranque staging con módulo Nest mínimo sin proveedores Shopify, OpenAI, Meta, WhatsApp ni tareas programadas. Bloqueo si API recibe URL Supabase distinta de la base staging o credenciales externas.
- Railway staging: clave interna API-Web y secreto de sesión Web NUEVOS y exclusivos de staging, configurados como cambios pendientes; **no se almacenaron en GitHub**.
- CI `.github/workflows/mw1-staging-ci.yml`: compilación API/Next y pruebas unitarias en push de la rama de staging. La ejecución/resultado AÚN no está comprobada.

## Verificación de seguridad (Supabase staging)
- Base de pruebas con RLS y restricciones públicas.
- Invocación de creación de producto con UUID no miembro: ERROR 42501 (rechazado).
- Invocación de cambio de estado por UUID no miembro: ERROR 42501 (rechazado).
- No hay cobros, envíos, pedidos reales ni integración con ATOGOB.
- La verificación de acceso multiempresa de extremo a extremo y las pruebas con un usuario válido siguen pendientes.

## Lo necesario ANTES de desplegar
1. Configurar exclusivamente en Railway **mw1-api-staging** el valor `SUPABASE_SECRET_KEY` del proyecto Supabase de prueba `zqfbxqszfnrbwpfukwak`. Nunca usar credenciales de los proyectos existentes `Chatpro-atogob`. No copiar el secreto al chat.
2. Verificar que el modo `MW1_STAGING_MODE=true` y `SUPABASE_URL=https://zqfbxqszfnrbwpfukwak.supabase.co` estén definidos.
3. Confirmar compilación `apps/api: npm ci && npm run build && npm test -- --runInBand staging-safety.spec.ts`, raíz web: `npm ci && npm run build`. Una definición de workflow no demuestra pruebas ejecutadas.
4. Aprovisionar propietario DEMO mediante script `apps/api/scripts/seed-staging-demo.mjs` con contraseña nueva y fuerte guardada en variable temporal del entorno aislado, nunca en producción.
5. Recibir aprobación explícita para aplicar el patch staged de Railway y activar los dos servicios de prueba.
6. Pruebas desde navegador: login, filtro de productos, alta de productos, pedidos, detalles, cambios de estado y denegación de usuarios cruzados; corregir fallas antes de ampliar.
7. Mantener **prod ATOGOB** separado; no hacer merges, migraciones ni cambios allí.

## Alcance no implementado todavía
- Importación de catálogos PDF/Excel; integraciones Tiendanube/WooCommerce.
- Creación de órdenes desde mensajes reales e IA; pagos por pasarela y validación de webhooks.
- Descuentos reales de inventario, guías y notificaciones.
- Super Admin de suscripciones y renovación.
- Bandeja con toda la funcionalidad original del CRM en staging.
- Navegación contextual de catálogo y pedidos desde todos los menús: hoy accesibles directamente en `/catalogo` y `/pedidos`; visible solo una vez desplegado y autenticado.

## Estado operacional
Staging Railway todavía tiene servicios `staged-create` (sin URL pública ni despliegue). Los proyectos existentes de ATOGOB no se modificaron. Un antiguo intento de desplegar chatpro-web en producción falló; el último servicio exitoso seguía ONLINE según Railway.
