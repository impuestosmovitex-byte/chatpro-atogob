# MW1 — Estado de lanzamiento y pruebas pendientes
Fecha de evaluación: 23 de octubre de 2026. Scope: MW1 staging, sin modificar producción de ATOGOB.

## Estimación de preparación (evaluación técnica orientativa, NO certificación)

**64/100 para un piloto controlado**, con 2–3 empresas externas, incorporación
manual, soporte cercano y sin comprometer funcionalidades en desarrollo.

| Criterio | Puntos | Evidencia y pendiente |
| --- | ---: | --- |
| Bandeja, canales y atención humana | 20/25 | ATOGOB y Emprende con Maogo operan; falta instalación y entrega real de mensajes en un nuevo cliente externo |
| IA, respuestas y catálogo | 15/20 | Uso real; fallos documentados de identificación de productos individuales versus conjuntos y combos; seguir validando |
| Multiempresa, roles y aislamiento | 14/25 | Directorio, demo y superadmin separados, pruebas unitarias; falta auditoría end-to-end contra fuga de datos entre dos empresas |
| Estabilidad, despliegue y monitoreo | 9/15 | Compilación CI, staging Railway; aún hay despliegues en cola y faltan pruebas de carga, alertas y recuperación |
| Incorporación, propuesta y pagos MW1 | 6/15 | Landing, demo, planes y borradores; no existe alta y cobro SaaS autoservicio comprobados |
| **Total piloto orientativo** | **64/100** | Puntaje conservador, no indica cobertura de código ni disponibilidad garantizada |

**Lanzamiento masivo/autoservicio: todavía no recomendado.** Cifra orientativa
40/100, distinta de la valoración del piloto.

## Validaciones obligatorias antes del primer cliente externo

1. Verificar que el último commit de GitHub esté realmente LIVE en el servicio web y API de staging Railway, y que `/por-que` devuelva HTTP 200 sin cookies y estando registrado como usuario de plataforma, sin redirigir a `/login` ni `/admin`.
2. Crear dos empresas de prueba independientes, con propietarios y asesores diferentes; verificar aislamiento de inbox, contactos, catálogos, IA, estadísticas, órdenes, integraciones y permisos a nivel API y base de datos. Rechazo de cambios de `companyId` manipulados.
3. Probar incorporación desde plan comercial hasta activación del propietario y conexión de WhatsApp/Instagram según plan; comprobar consumo, límites y suspensión sin tocar ATOGOB.
4. Hacer suite de conversaciones reales con mensajes, fotos y variantes; reconocer primero producto individual si solo se muestra una prenda; **nunca ofrecer combo/conjunto no mostrado**. Probar escalamiento IA → humano y preguntas de políticas.
5. Confirmar que no se reutilicen credenciales de Meta, Shopify, API OpenAI, secrets o pasarelas entre clientes, que los tokens se roten, y que no aparezcan secretos en logs ni en UI.
6. Pruebas de disponibilidad y reintentos: envío entrante/saliente, webhooks duplicados, retrasos, mensajes fuera de horario, límites de IA y caídas del proveedor. Alertas y control de costos por tenant.
7. Contrato/SLA inicial y soporte, consentimiento y políticas de tratamiento de datos, canal para incidencias y cancelación de servicio. Facturación puede ser manual en piloto si está comunicada y documentada.
8. Validar la publicación desde borrador a precio público. No cambiar entitlements de clientes existentes por una publicación comercial.
9. Simulación de pérdida y recuperación; respaldos para staging/prod, sin copiar datos privados de clientes entre entornos.

## No bloquea piloto limitado si está expresamente rotulado como roadmap

- Enlaces de pago generados desde el chat y checkout con proveedor.
- Pedidos nativos, inventario y despacho en Plan Pro.
- Integraciones de tiendas no validadas, autoalta de clientes y cobro recurrente automático.
- Medición completa de tokens de OpenAI por empresa y margen reconciliado; sí se debe
  usar presupuesto/límites defensivos e indicar que aún no existe contabilidad exacta.

## Principio de seguridad

Nunca activar un plan o cambiar límites operativos de ATOGOB por vincularlo
comercialmente a MW1. Tratar suscripciones y cobros MW1 separados de los cobros
de ventas que recibe cada empresa. No confundir cotizaciones, facturas y pagos.

## Claims comerciales sin validar

No publicar 70 % / 50 % / 40 % sin fuente, muestra y metodología.
No prometer evitar bloqueos de Meta, garantizar conversiones/ahorros o que
integraciones previstas ya funcionan. La landing usa lenguaje condicional.
