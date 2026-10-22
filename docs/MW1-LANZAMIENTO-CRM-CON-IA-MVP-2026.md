# MW1 — Examen real y lanzamiento inicial como CRM con IA

**Corte:** 21 de octubre de 2026. **Versión:** 2.0. Alcance: el CRM que YA se utiliza con ATOGOB y Emprende con Maogo.

## Corrección fundamental

El porcentaje anterior de 27–37% medía un roadmap AMPLIADO: PDF, reconocimiento visual avanzado, creación interna de pedidos, catálogo universal y conectores WooCommerce/Tiendanube. **NO es una medida útil para decidir cuándo vender MW1 como CRM con IA.** El CRM base existe y está atendiendo operaciones reales.

El backend staging de ventas internas excluye deliberadamente webhooks e integraciones reales. **Nunca reemplazar el backend operativo con ese módulo de staging.**

## Alcance de la primera venta

CRM multiempresa con bandeja y conversaciones, clientes, roles y equipo, IA de ventas y soporte, atención humana, WhatsApp, conexiones existentes según verificación, automatizaciones disponibles, estadísticas y leads donde corresponda. Comercialización con incorporación guiada de pocos clientes. No prometer que toda conexión marcada en verde está probada de principio a fin.

**FUERA DEL MVP comercial**: PDF escaneado y catálogos universales, creación de pedidos internos, precios por chat, integraciones nuevas con WooCommerce/Tiendanube, visión avanzada y autogestión completa de facturación.

## Indicador comercial

**85 de 100**, estimación razonada de preparación para comercialización guiada, basada en funcionalidades reales demostradas y componentes de código. No es una métrica automática ni sustituye pruebas de seguridad y aceptación.

## Auditoría de las 10 capturas recibidas

| Área | Evidencia visible | Evaluación |
| --- | --- | --- |
| Bandeja | Conversaciones ATOGOB, filtros por canal, humanos e IA | Operativa con uso real |
| Clientes | 120 contactos mostrados, etiquetas e historial | Operativa con datos |
| IA | «Sofía» configurada, ventas, servicio, conocimiento y modo prueba | IA comercial existente |
| Automatizaciones | 7 activas, 67 enviadas, 3 pendientes, 5 fallidas | Opera; hay que revisar fallas |
| Estadísticas | 69 conversaciones, 234 entrantes, 131 respuestas IA, 53 humanas, 13 transferencias; 188 «sin responder» | Tiene métricas; revisar antigüedad |
| Configuración | Empresa, equipo/roles, horarios, áreas e integraciones | Interfaz implementada |
| Integraciones | WhatsApp y Shopify activos, Instagram conectada, Messenger activa | Registro visible; falta validar cada canal extremo a extremo |
| Multiempresa | Cambio de ATOGOB a Emprende con Maogo | Cambio de empresa implementado |
| Leads | 36 leads de Maogo con origen y estados | Módulo usado |
| Código | AccessController, cambio de empresa, membresías, integraciones, bandeja, IA y memoria | Arquitectura multiempresa existente |

Audio e interpretación de imágenes: el operador declara uso real y el código tiene esas capacidades. Las capturas por sí solas no demuestran cada escenario.

## Checklist mínimo de lanzamiento comercial — cinco controles

| ✓ | ID | Prioridad | Criterio de aceptación y tarea | Estado |
| --- | --- | --- | --- | --- |
| [ ] | C01 | P0 | Seguridad posterior al incidente Railway: revisar alcance, revocar/rotar claves que correspondan, verificar accesos y logs de manera segura, sin detener ATOGOB | Por verificar |
| [ ] | C02 | P0 | Aislamiento de dos empresas en pruebas: usuario A no puede acceder a chats, clientes, leads, IA ni integraciones de B mediante URL, API o cambio de sesión | Por verificar |
| [ ] | C03 | P0 | Probar un flujo completo de otra empresa: mensaje WhatsApp entrante, respuesta IA, derivación humana, respuesta saliente, datos y permisos correctos | Por verificar |
| [ ] | C04 | P0 | Analizar 5 automatizaciones fallidas, 3 pendientes y la cifra «188 sin responder»; corregir fallos reales, probar reintentos y observabilidad | Por diagnosticar |
| [ ] | C05 | P0 | Plan y precio, límites del producto, soporte, privacidad/consentimiento, respaldo restaurable y procedimiento guiado de alta de primer cliente | Por definir/comprobar |

**Go/no-go:** ofrecer a nuevos clientes con atención guiada cuando TODOS C01–C05 estén comprobados. No esperar por PDF, Tiendanube, WooCommerce ni pedidos internos. No marcar una tarea como terminada por mostrar una interfaz; exigir un resultado real.

## Etapas

1. Ahora, sin nuevos despliegues Railway: preparar casos de prueba para C02–C04, plan comercial C05, conservación del respaldo. No tocar producción.
2. Con Railway recuperado y tras atención de seguridad C01: pruebas controladas con empresas distintas y flujos completos.
3. Con cinco controles aprobados: iniciar ventas del CRM con IA y onboarding asistido; ampliar gradualmente el piloto.
4. Luego: roadmap ampliado, sin bloquear la comercialización inicial.

**Railway Online** indica servicios existentes en ejecución; no demuestra que la última rama de GitHub ya esté publicada ni que se puedan desplegar cambios.

## Evidencia

- GitHub rama de desarrollo: https://github.com/impuestosmovitex-byte/chatpro-atogob/tree/feature/mw1-saas-staging-20261020
- Respaldo: https://github.com/impuestosmovitex-byte/chatpro-atogob/tree/backup/mw1-staging-snapshot-20261021
- Validación de cambios staging: https://github.com/impuestosmovitex-byte/chatpro-atogob/actions/runs/39693565226
- Plan amplio anterior: docs/MW1-PLAN-LANZAMIENTO-MULTIEMPRESA-2026.md; NO usar sus porcentajes para decidir el lanzamiento del CRM básico.
