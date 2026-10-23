# MW1 — Prueba de incorporación del primer cliente piloto (staging)

Fecha: 2026-10-23. Objetivo: validar **el CRM actual**, sin nuevas funciones ni datos de
ATOGOB/Emprende con Maogo. No usar credenciales, catálogos ni números de
WhatsApp de empresas operativas para pruebas.

## Estado verificado antes del piloto

- `mw1-web-staging` y `mw1-api-staging` están en línea con CI aprobado.
- Staging Supabase: 2 empresas demo (`mw1-demo-disfraces`, `mw1-demo-mercado`).
- Usuarios activos de prueba: mercado 1, disfraces 0.
- Integraciones registradas: 0. Sin canales reales, **no se ha probado
  intercambio de mensajes**.
- Entidades centrales de empresa, usuarios, planes e integraciones: RLS activo;
  roles anon/authenticated sin acceso directo. **Esto no prueba por sí solo
  el aislamiento de todos los endpoints que operan con service_role.**
- No hay cuentas nuevas activadas ni clientes pagadores creados con esta preparación.

## Lista obligatoria de verificación del primer piloto

1. **Formulario público**: visitante sin sesión abre `/precios`, selecciona
   Básico/Eco/Pro, entra en `/prueba-gratis?plan=eco` y envía una solicitud de
   prueba con consentimiento, usando datos autorizados de una persona de prueba.
2. **Bandeja**: superadmin abre `/admin/empresas`, confirma que la solicitud
   aparece con plan, teléfono y estado de WhatsApp. Marca `contactada`,
   deja nota sin secretos y registra próxima fecha. Confirmar persistencia al refrescar.
3. **Calificación**: después de confirmar viabilidad, marcar `calificada`,
   usar `Preparar alta de empresa`. Debe cargar *solo* nombre/slug y propuesta
   de plan, nunca credenciales ni datos de otra empresa.
4. **Revisión de permisos**: comprobar el plan comercial y su clave interna
   (`Básico → inicial`, `Eco → pro`, `Pro → empresa`), límite de usuarios,
   líneas WA y módulos. **Tres o cinco conexiones comerciales no equivalen a
   tres o cinco líneas de WhatsApp.** Confirmar controles manuales.
5. **Alta aislada**: un operador autorizado proporciona el código y la contraseña
   provisional de un propietario de **prueba**, diferentes de todo usuario operativo.
   Crear empresa y acceder desde otra ventana en incógnito. La cuenta debe
   ver únicamente su empresa. Rotar la contraseña y no copiarla en chats/notas.
6. **Aislamiento extremo a extremo**: con sesión del propietario A, intentar
   forzar en solicitudes de API los ID de empresa B para leer/escribir
   clientes, conversaciones, imágenes, catálogos, archivos, integraciones y
   ajustes. Debe obtenerse acceso denegado o respuestas sin registros de B.
   Repetir al revés. Revisar errores y logs sin exponer PII.
7. **WhatsApp**: con un número exclusivamente de prueba y permisos propios
   de Meta, revisar si procede coexistencia con WhatsApp Business o alta
   nueva. Nunca desinstalar, migrar, ni desconectar cuentas sin aprobación.
   Registrar estado de conexión por su significado real.
8. **Prueba de mensajes**: enviar mensaje entrante real, responder desde bandeja,
   comprobar transferencia IA → humano, reconexión y mensajes duplicados.
   Revisar la regla: si la imagen muestra solo una prenda, no ofertar conjunto
   o combo que no aparece.
9. **Vencimiento y cobro**: documentar fecha de inicio al **activar manualmente**
   la prueba; hoy el formulario no activa una cuenta ni genera facturación.
   No comunicar que la facturación automática o renovaciones ya funcionan.
10. **Salida**: aprobar solo si todos los pasos críticos se verifican con
    evidencias controladas. Si algo falla, mantener el piloto supervisado y
    sin abrir inscripciones masivas.

## Avance del formulario de alta

Las solicitudes comerciales calificadas pueden preparar el formulario interno
con las características recomendadas del plan. La persona administradora debe
verificar y confirmar módulos y propietario antes de ejecutar creación.
No existe activación automática desde el lead. Los valores se definen en
`app/lib/mw1-pilot-onboarding.ts`; los permisos reales solo nacen en la API
`platform-admin/companies` mediante una acción expresa.

## Requisitos de operación

- Contar con una cuenta de correo y número **de prueba** autorizados para el piloto.
- Proporcionar credenciales al propietario por canal seguro, sin escribirlas
  en las notas comerciales. No inventar una contraseña para el primer
  usuario real.
- Contar con autorización Meta y procedimiento de recuperación / soporte.
- Conservar ATOGOB y Emprende con Maogo operando en sus entornos actuales.
