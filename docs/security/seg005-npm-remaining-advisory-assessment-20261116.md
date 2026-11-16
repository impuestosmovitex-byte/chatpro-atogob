# SEG-005 — Clasificación de las 28 alertas de npm
Fecha: 16 noviembre 2026. Fuente primaria: ejecución automática **43848215454** en GitHub Actions, inventario generado por `npm audit --json` + `npm audit --json --omit=dev`, sobre PR #78. **Sin actualización, despliegue ni merge.**

## Hallazgos verificados
- Árbol completo de API: 28 entradas reportadas: **23 moderadas, 5 bajas**, sin altas ni críticas.
- Árbol de ejecución excluyendo `devDependencies`: **0** entradas de severidad alguna.
- Todas las 28 aparecen **solo** en el inventario completo; el script confirmó `runtimeFlag:false` para las 28.
- Estas entradas incluyen vulnerabilidades derivadas/transitivas: no significan necesariamente 28 avisos independientes. Los únicos paquetes de la lista con un aviso directo (`via` objeto) son **`glob`**, **`minimatch`** y **`deepmerge`** en la auditoría obtenida. El resto propaga dependencias vulnerables.
- Clasificación de riesgo: **no observadas en árbol runtime por npm** no significa que las herramientas de build/CI sean invulnerables o que el contenedor del laboratorio no tenga archivos de desarrollo instalados. La imagen actual ejecuta `npm ci` sin `--omit=dev`; separar runtime de build es un trabajo adicional.

## Agrupación de entradas npm
| Grupo de origen | Paquetes afectados en el reporte | Prioridad | Qué validar |
| --- | --- | --- | --- |
| `glob` y `minimatch` | `glob`, `minimatch`, `test-exclude`, `babel-plugin-istanbul`, `@jest/reporters`, `jest-config`, `jest-runtime`, `@jest/core`, `@jest/transform`, `jest-runner`, `babel-jest`, `@nestjs/cli`, `@typescript-eslint/typescript-estree` y sus dependientes | Media, prioridad en CI | Identificar rango vulnerable, patrones no confiables, cadena de actualización transitiva y scripts ejecutados |
| `deepmerge` | `deepmerge`, `fork-ts-checker-webpack-plugin`, `jest`, `jest-cli`, `ts-jest` y transitivas | Media-baja | Comprobar si se procesan configuraciones no confiables, revisar rangos compatibles |
| Propagaciones de Jest | `@jest/expect`, `@jest/globals`, `jest-circus`, `jest-resolve-dependencies`, `jest-snapshot`, `@jest/transform`, `jest-runtime`, `@jest/core`, `@jest/reporters`, `jest-runner` | Media-baja | No contar cada entrada como vulnerabilidad raíz nueva; probar compatibilidad antes de elevar versiones |
| ESLint / TypeScript | `@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser`, `@typescript-eslint/type-utils`, `@typescript-eslint/typescript-estree`, `@typescript-eslint/utils`, `typescript-eslint` | Media-baja | No ejecutar lint/CLI con inputs no confiables hasta definir mitigaciones |

**Nota:** Los grupos se solapan deliberadamente: las 28 entradas únicas del reporte no deben sumarse fila a fila.

### Entradas directas y versiones observadas
- `glob`: versiones `10.5.0`, `13.0.6` en nodos inventariados; severidad moderada.
- `minimatch`: versiones `9.0.9`, `10.2.6`; severidad moderada.
- `deepmerge`: versión `4.3.1`; severidad baja.

Las entradas `via` de npm para los otros paquetes son nombres de dependencias; no se debe atribuirles una explotación propia sin datos adicionales. Los URLs/GHSA y rangos exactos deben consultarse en el reporte npm completo antes de elegir parches.

## Recomendación de remediación
1. Mantener PR #78 DRAFT y no cambiar el comando de instalación o línea base productiva.
2. Antes de exponer servicios: conservar puerta dura **0 avisos runtime** y pruebas completas **266/266**; reevaluar novedades del registro npm.
3. En un PR independiente de herramientas de desarrollo, intentar `npm update` selectivo para dependencias con arreglos compatibles; probar `jest`, Nest CLI, ESLint, TypeScript y pipeline de paquetes. No asumir que `npm audit fix --force` es seguro.
4. Revisar que las imágenes finales de producción/lab no instalen innecesariamente herramientas `dev`; esto requiere cambios validados de builder/release, no solo cambiar `npm ci`.
5. Revisar la seguridad de artefactos de CI: permisos `contents:read`, no ejecutar código de PR no confiables con credenciales o permisos write, y mantener separadas las ramas de release.
6. Para integración combinar SEG-004 (#73) y SEG-005 (#78) **en una rama aislada**; jamás mergear directamente #73 a su base rastreada por producción sin autorización explícita.

## Limitaciones
La auditoría es un snapshot del 16 nov 2026, no un certificado permanente. No demuestra exposición o explotabilidad de cada aviso, solo el alcance del inventario de npm. Ningún archivo real de cliente ni URL de Meta fue utilizado.
