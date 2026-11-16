# MW1 — Plan de integración segura SEG-005 + SEG-004
Fecha: 16 noviembre 2026. **Plan, no autorización de merge ni deployment.**

## Evidencia ya obtenida
- PR #73 `security/mw1-social-media-authz-20261116` → base `fix/seg002-prod-api-minimal-20261111`. PR **DRAFT** sin fusionar. Añade autorización de media social y laboratorio sintético.
- PR #78 `security/seg005-npm-dependency-remediation-20261116` → base **rama de PR #73**. PR **DRAFT** sin fusionar. `apps/api/package-lock.json` actualizado mediante `npm audit fix --package-lock-only`, sin `--force`; `package.json` sin cambio.
- CI de #78: 20 suites/266 tests verdes, compilación Nest, HTTP localhost sintético, `npm audit --omit=dev` cero avisos. Auditoría árbol completo reportó 28 avisos (23 moderados, 5 bajos); inventario detallado en CI adicional.
- Laboratorio Railway ya existente `mw1-media-lab-isolated` está fijado a commit antiguo `cced0f24f2df2963a9106e1e9e80a69b27017362`. No recibe cambios del PR automáticamente.
- Se eliminó de #78 el **workflow temporal con permiso contents:write**, porque la reparación del lockfile ya fue guardada. Conservar solo CI de lectura/validación.

## Riesgo principal de integrar sin cuidado

La base de PR #73, `fix/seg002-prod-api-minimal-20261111`, era la rama de la API productiva según la auditoría anterior. **Nunca fusionar #73 directamente a dicha rama sin verificar la configuración actual de Railway y una autorización explícita de release de producción.** Un merge en una rama monitorizada puede desplegar sin segundo aviso. Tampoco cambiar source/branch/pinned commit del laboratorio ni conectar canales reales.

## Orden recomendado (no ejecutar hasta autorización específica)

1. **Cerrar la clasificación de las 28 alertas:** guardar por paquete/advisory/versión/árbol/versión reparable y evaluar exposición. `npm audit --omit=dev=0` indica que no son parte del árbol runtime seleccionado por npm, pero no demuestra que herramientas de compilación de CI o scripts no puedan comprometer artefactos. Investigar primero los módulos de CI/build con permisos o scripts y upgrades de bajo riesgo. No usar `npm audit fix --force`.
2. **Revisión formal PR #78:** confirmar solo lockfile y workflows de comprobación sin escritura; revisión de `@nestjs/platform-express`, `proxy-addr`, `body-parser`, `multer`, `handlebars`; versión Node 22; `npm ci`, 266 tests, compilación, preflight de lab y auditoría runtime cero. Revalidar advisories frescos antes del merge.
3. **Rama de integración aislada:** crear una **nueva rama de prueba** desde la misma base de código que se desea probar; incorporar conjuntamente #73 y #78 en ella, sin fusionar todavía en la rama vigilada por Railway producción. Evitar conectar automáticamente staging comercial a esta rama: el staging actual monta `StagingAppModule` en vez del controlador social operativo. Conservar rollback con SHAs.
4. **Validación aislada** con tenants ficticios: probar rutas HTTP reales de descarga 200/401/403/404, rangos y límites de 15 MiB/timeout/redirecciones; controles SSRF, egress/DNS y ausencia de conexiones de Meta, WhatsApp, IA y Shopify en laboratorio. La prueba de URLs **reales** de Meta requiere una aprobación separada y cuenta piloto independiente.
5. **Decisión de releases, por separado:** primero revisar resultado y aprobar explícitamente el merge de código con alcance exacto; luego aprobación explícita para apuntar/deplegar el servicio objetivo concreto. Hacer primero release controlada en un ambiente independiente con monitoreo de logs y reversión; producción requiere otra aprobación.
6. **Post-release:** vigilar respuestas de media, permisos cross-tenant, regresiones de bandeja, IA, WhatsApp, automatizaciones, y revisar periódicamente auditoría de npm; revertir si aparece fuga o errores de descarga.

## Puertas de no avance (fail-closed)
- No se comprueba que los 28 avisos solo afecten herramientas que no sirven solicitudes ni ejecutan scripts privilegiados.
- `npm audit --omit=dev` detecta cualquier crítica o alta, o el QA funcional/compilación empeora.
- PR #73 o #78 deja de ser DRAFT sin revisión de seguridad.
- Falta una ruta E2E para validar realmente el controlador modificado por #73 en un entorno aislado.
- La rama objetivo es una fuente de despliegue automático en Railway, o falta rollback ensayado.
- Se solicita habilitar dominio público o conectar Meta real sin análisis/consentimiento específicos.

**Estado de esta aprobación:** únicamente inventario y plan; ningún merge, ningún deploy.
