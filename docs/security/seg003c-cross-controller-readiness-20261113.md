# SEG-003C — Gate de compatibilidad fuera del superadministrador (2026-11-13)

**Estado:** revisión de código y pruebas sintéticas. **NO FUSIONAR NI DESPLEGAR** con esta auditoría como única evidencia. Las ramas #38 (API) y #39 (web) deben desplegarse **conjuntamente** tras la instalación de claves y validaciones de staging.

## Comprobaciones completadas en ramas GitHub

- `platform-admin.controller.ts`: 35 operaciones inventariadas; 32 firmadas; 3 excepciones justificadas y verificadas por CI.
- `users.controller.ts`: 4 operaciones verifican rol/membresía en DB y firma en staging.
- `roles.controller.ts`: 3 operaciones firmadas, pero **el controlador no figura en StagingAppModule**; requiere decisión de producto y pruebas antes de activarlo.
- `staging-subscription-admin.controller.ts`: GET (listar solicitudes) y POST /review preparadas con firma de identidad `platform`, que deriva de cookie web verificada.
- `access.controller.ts`: POST /switch-company preparado con prueba firmada que incorpora usuario y empresa **de origen**, y liga el cuerpo con la empresa destino; no cambiar login ni bootstrap.

## Bloqueantes pendientes antes de staging

| Bloqueante | Alcance | Riesgo y paso siguiente |
| --- | --- | --- |
| **P0** | `staging-my-plan.controller.ts` | Seis rutas de plan y checkout aún basan el principal de usuario en cabeceras y clave compartida; firmar desde las rutas web correctas, con contratos y pruebas. No activar checkout real. |
| **P0** | `staging-clients-readonly.controller.ts` | GET /clients y /clients/profile: los filtros por empresa son útiles, pero el actor está indicado por cabeceras; añadir prueba de sesión firmada para la empresa y parámetros del recurso. |
| **P0** | `staging-inbox.controller.ts` | GET /staging-inbox y /instagram-pilot, cabeceras de usuario/empresa; revisar firma y aislamiento antes de usar en piloto externo. |
| **P1** | `access-capabilities.controller.ts` | Capacidades y empresas autorizadas reciben `user` por query; evaluar firma y consistencia de sesión. |
| **P1** | Otros controladores cargados en `staging-app.module.ts` | Inventariar rutas con identidad por encabezados sin firma, distinguir webhooks y endpoints públicos legítimos; no introducir reglas que bloqueen Meta o Mercado Pago. |
| **P0** | Sistema antirreplay | `MW1_INTERNAL_SINGLE_REPLICA_ACK` solo permite mapa de nonces local con 1 réplica; no habilitar múltiples réplicas sin store compartido atómico. |
| **P0** | Entornos y despliegue | Clave privada Ed25519 en web y pública en API, configuradas fuera de GitHub; verificar `MW1_STAGING_MODE=true` y plan de reversión. |
| **P0** | Flujo autenticación real | Pruebas de inicio sesión, cambio de empresa, pérdida de acceso, roles, altas, bandeja y pilotos con datos ficticios en un staging autorizado; el CI no equivale a esta prueba. |

## Regla de release

NO desplegar PR #36/#37/#38/#39 de forma independiente; no fusionarlos a ramas de producción sin autorización. Las rutas web preparadas envían aserciones que un backend antiguo no exige, pero las API endurecidas requieren claves y web compatible para no bloquear clientes.

**Nota:** hay componentes públicos sin sesión previa, como webhooks, login, activación inicial y solicitudes asistidas de recuperación. Su protección debe diferenciar identidad del servicio, origen permitido y firma propia del proveedor; nunca imponer sesión de usuario a estos flujos.
