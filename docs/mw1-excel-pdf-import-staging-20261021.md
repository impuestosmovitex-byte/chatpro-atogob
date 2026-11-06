# MW1 staging — Excel y PDF de tres productos (2026-10-21)

## Alcance
Esta fase extiende `/catalogo/importar` para admitir archivos `.xlsx`, PDF **de texto tabular** y CSV, en el entorno aislado `mw1-saas-staging`. El catálogo cargado se revisa antes de aprobarlo. La importación final se realiza por la API autenticada `native-commerce/catalog/import-csv` y una RPC transaccional de Supabase, guardando la fuente `excel`, `pdf` o `csv`.

La importación de Excel se limita a la primera hoja y 100 productos; PDF se limita a PDF de texto con los encabezados SKU, Nombre, Precio e Inventario y secuencia de texto simple, no OCR. Los archivos no se almacenan; solo los artículos normalizados y aprobados. Límite 1 MB y lectura sin llamadas externas.

## Archivos ficticios preparados para la prueba manual
Los archivos siguientes fueron generados en la sesión de ChatGPT (no se almacenan en GitHub):
- Excel `MW1_catalogo_prueba_excel_3_productos.xlsx`: EXCEL-ARROZ-101, EXCEL-ACEITE-102, EXCEL-AZUCAR-103.
- PDF `MW1_catalogo_prueba_PDF_3_productos.pdf`: PDF-PIRATA-201, PDF-BRUJA-202, PDF-CAPA-203.

La inspección local independiente de la estructura ZIP/XML de Excel y de los operadores de texto del PDF recuperó los 3 artículos de cada archivo, con valores correctos. NO se ha efectuado aún la carga autenticada de esos archivos en el navegador.

## Trabajo técnico realizado
- `app/lib/staging-office-import.ts`: extractores acotados para ZIP/XML de XLSX y PDF con texto digital; se corrigió compatibilidad con prefijos XML `x:row`, `x:c`, etc. No ejecuta macros ni fórmulas.
- `app/api/native-commerce/catalog/parse-file/route.ts`: endpoint de vista previa autenticado, exclusivo de staging, sin persistencia de archivos.
- `app/catalogo/importar/page.tsx`: selector de CSV / Excel / PDF, vista previa, errores y aprobación.
- `supabase/migrations/202610210014_file_import_preserve_source.sql`: RPC nueva `mw1_commerce_import_file_catalog` y fuente adecuada según el formato.
- `apps/api/src/native-commerce.controller.ts`: el importador elige `excel`, `pdf` o `csv` y verifica autorización antes de guardar.

## Verificaciones de base de datos en staging
- Migración 014 aplicada correctamente en Supabase `zqfbxqszfnrbwpfukwak`.
- Dos importaciones sintéticas se ejecutaron dentro de subtransacciones que se revirtieron, verificando fuente `excel` y `pdf`. Consulta posterior: 0 SKU QA temporal residual.
- No se han importado aún los seis SKU exactos de los archivos del usuario, así podrá subir ambos consecutivamente sin colisiones.
- RLS y permisos siguen restringiendo acceso directo a los datos.

## BLOQUEO de despliegue actual
Railway devolvió `Deploys have been paused temporarily` al intentar volver a conectar los servicios de staging. Se preparó y aplicó un patch de configuración NO destructivo en `mw1-saas-staging`, pero `list_deployments` sigue mostrando último commit desplegado `6d4c729721af01fa4cc72c445425616f9a0f1a7d`, anterior a este importador.

**NO afirmar que la nueva carga PDF/XLSX esté disponible en la web** hasta ver nuevos commits desplegados con `SUCCESS` y pruebas desde el navegador.

## Próximas pruebas
1. Reanudar despliegue de web y API en staging, compilar TypeScript/Next y revisar registros.
2. Entrar en `https://mw1-web-staging-staging.up.railway.app/catalogo/importar`.
3. Subir Excel y verificar vista previa de exactamente 3 productos, SKU/precio/inventario.
4. Aprobar e inspeccionar `commerce_catalog_sources.kind='excel'` y los tres SKU.
5. Repetir con PDF (otros SKU), comprobar tres filas y `kind='pdf'`.
6. Validar en `/catalogo` y `/pedidos/simulador` los seis productos.
7. Verificar duplicados, rollback, límite de plan y bloqueo de otras empresas en el navegador.
8. A continuación: extracción robusta de PDF escaneados con OCR, imágenes y variantes, y RAG/IA para pedidos por conversación en el entorno de pruebas.
9. NO tocar ATOGOB producción; mantener sin WhatsApp ni pasarelas reales.
