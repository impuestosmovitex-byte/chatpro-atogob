# MW1 · Búsqueda visual de productos — staging (2026-10-21)

## Estado
Desarrollado **solo** en `feature/mw1-saas-staging-20261020`, con Supabase de pruebas `zqfbxqszfnrbwpfukwak`. El proyecto ATOGOB de Railway **no se modificó**.

## Funciones
- Fotos privadas por variante y empresa: `/catalogo/imagenes`, hasta 512 KB por archivo JPEG/PNG/WebP.
- Bucket `mw1-staging-products` privado, sin acceso público; los previews se sirven mediante URLs firmadas de corta duración.
- Integridad con claves foráneas empresa/producto/variante y RLS habilitado.
- Botón para adjuntar imagen desde `/pedidos/simulador`.
- Si el cliente envía exactamente la misma imagen que está catalogada, reconocimiento mediante SHA-256, sin costo de IA.
- Si la foto es diferente, comparación visual con OpenAI solo cuando `MW1_STAGING_VISION_ENABLED=true` **y** `MW1_STAGING_OPENAI_API_KEY` exclusiva de pruebas estén configuradas. No reutilizar claves de producción. En este estado, no afirmar que la comparación está activada.
- Límite inicial de comparación: ocho fotos por consulta (no búsqueda exhaustiva); hasta tres sugerencias, ninguna aceptada automáticamente.
- Sin pedidos automáticos, sin cobros y sin mensajes de WhatsApp; cliente o asesor debe confirmar la variante antes de agregarse al carrito.
- Restricción de cinco consultas visuales por usuario y minuto en esta primera versión.

## Pruebas en GitHub
- Pruebas unitarias: MIME, límites de tamaño, coincidencia exacta, validación de IDs y confirmación obligatoria.
- Compilaciones Next.js y Nest API aprobadas en CI.
- Storage y datos protegidos, bucket `public=false`; 0 lecturas directas de la tabla de imágenes por `anon` o `authenticated`.

## Pendientes importantes
1. Comprobar nuevo despliegue en Railway staging: el último commit de GitHub está adelantado respecto a los servicios online.
2. Abrir `/catalogo/imagenes` con `MW1DEMO`, registrar una foto de referencia ficticia.
3. Subir la **misma** imagen en `/pedidos/simulador` y verificar coincidencia exacta + propuesta de referencia.
4. Activar (por configuración explícita) clave OpenAI exclusiva de pruebas si se requiere comparación con fotos diferentes.
5. Probar una foto ligeramente cambiada, una foto de otro producto, una foto con varios productos y una variante de otra empresa.
6. Ampliar para cientos/miles de fotos con índice visual y ranking en vez de enviar las últimas ocho fotografías.
7. Permitir borrar fotos, controlar retención de imágenes y auditar gastos de visión por empresa.
8. Más adelante procesar páginas de PDF y capturas con varias referencias.

Esta entrega NO implementa aún búsqueda exhaustiva por foto ni atención visual por WhatsApp.
