/**
 * Offline QA for MW1's isolated CSV/XLSX/text-PDF importers.
 *
 * Run locally or in GitHub Actions:
 *   node scripts/test-native-catalog-import.cjs
 *
 * This reads code and in-memory synthetic fixtures; no Railway, Supabase,
 * network requests, secrets, real client records or production integrations.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const typescript = require('typescript');

const ROOT = path.resolve(__dirname, '..', 'app', 'lib');

function loadTypescript(file) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const transpiled = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: file,
    reportDiagnostics: true,
  });
  const errors = (transpiled.diagnostics || []).filter(
    issue => issue.category === typescript.DiagnosticCategory.Error
  );
  assert.equal(errors.length, 0, 'TypeScript transpilation: ' + file);
  const module = {exports: {}};
  const localRequire = specifier => specifier === './staging-csv-preview'
    ? csvModule
    : require(specifier);
  new Function('module', 'exports', 'require', transpiled.outputText)(
    module, module.exports, localRequire
  );
  return module.exports;
}
const csvModule = loadTypescript('staging-csv-preview.ts');
const officeModule = loadTypescript('staging-office-import.ts');

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i=0; i<8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function packXlsx(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBuffer = Buffer.from(name, 'utf8');
    const dataBuffer = Buffer.from(data, 'utf8');
    const crc = crc32(dataBuffer);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(dataBuffer.length, 18);
    localHeader.writeUInt32LE(dataBuffer.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    local.push(localHeader, nameBuffer, dataBuffer);

    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(dataBuffer.length, 20);
    directory.writeUInt32LE(dataBuffer.length, 24);
    directory.writeUInt16LE(nameBuffer.length, 28);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, nameBuffer);
    offset += localHeader.length + nameBuffer.length + dataBuffer.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

const escapeXml = value => String(value).replace(/&/g, '&amp;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function makeXlsx(products, includeFacts = false) {
  const data = includeFacts
    ? [['SKU', 'Nombre', 'Precio', 'Inventario', 'Descripcion', 'Material',
        'Composicion', 'Medidas', 'Ingredientes', 'Alergenos', 'Cuidados', 'Caracteristicas'],
        ...products.map(p => [
          p.sku,p.name,p.price,p.stock,p.facts?.description||'',
          p.facts?.material||'',p.facts?.composition||'',p.facts?.measurements||'',
          p.facts?.ingredients||'',p.facts?.allergens||'',p.facts?.care||'',
          p.facts?.details||'',
        ])]
    : [['SKU', 'Nombre', 'Precio', 'Inventario'],
        ...products.map(p => [p.sku, p.name, p.price, p.stock])];
  const xmlRows = data.map((cells, rowNumber) => {
    const cellsXml = cells.map((value, column) => {
      const ref = String.fromCharCode(65 + column) + (rowNumber + 1);
      return typeof value === 'number'
        ? '<x:c r="' + ref + '"><x:v>' + value + '</x:v></x:c>'
        : '<x:c r="' + ref + '" t="inlineStr"><x:is><x:t>'
          + escapeXml(value) + '</x:t></x:is></x:c>';
    }).join('');
    return '<x:row r="' + (rowNumber + 1) + '">' + cellsXml + '</x:row>';
  }).join('');
  const sheet = '<?xml version="1.0" encoding="UTF-8"?>'
    + '<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<x:sheetData>' + xmlRows + '</x:sheetData></x:worksheet>';
  const workbook = '<?xml version="1.0" encoding="UTF-8"?>'
    + '<workbook><sheets><sheet name="Productos" sheetId="1"/></sheets></workbook>';
  return packXlsx([
    ['xl/workbook.xml', workbook],
    ['xl/worksheets/sheet1.xml', sheet],
  ]);
}

function makePdf(products) {
  const escaped = value => String(value).replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const pieces = ['SKU', 'Nombre', 'Precio COP', 'Inventario',
    ...products.flatMap(row => [row.sku, row.name, row.price, row.stock])];
  const text = 'BT\n' + pieces.map(value => '(' + escaped(value) + ') Tj')
    .join('\n') + '\nET';
  const compressed = zlib.deflateSync(Buffer.from(text, 'latin1'));
  return Buffer.concat([
    Buffer.from('%PDF-1.4\n1 0 obj\n<< /Filter /FlateDecode /Length '
      + compressed.length + ' >>\nstream\n', 'latin1'),
    compressed,
    Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1'),
  ]);
}

const sample = [
  {sku: 'MW1-RICE-01', name: 'Arroz', price: 4500, stock: 10},
  {sku: 'MW1-OIL-02', name: 'Aceite', price: 12500, stock: 6},
  {sku: 'MW1-SUGAR-03', name: 'Azucar', price: 5800, stock: 12},
];
const expected = sample.map(p => ({
  sku: p.sku, name: p.name, price: p.price, stock: p.stock,
}));

const parsedXlsx = officeModule.previewXlsxFile(makeXlsx(sample));
assert.deepEqual(parsedXlsx.errors, [], 'Excel sin errores');
assert.deepEqual(parsedXlsx.rows, expected, 'Excel de tres productos');

const parsedPdf = officeModule.previewPdfFile(makePdf(sample));
assert.deepEqual(parsedPdf.errors, [], 'PDF sin errores');
assert.deepEqual(parsedPdf.rows, expected, 'PDF digital de tres productos');

const parsedCsv = csvModule.previewCsv(
  'SKU;Nombre;Precio;Inventario\n'
  + sample.map(p => [p.sku,p.name,p.price,p.stock].join(';')).join('\n')
);
assert.deepEqual(parsedCsv.rows, expected, 'CSV de tres productos');

const enriched=[
  {sku:'VESTIDO-001',name:'Vestido negro',price:49000,stock:2,
    facts:{description:'Vestido corto confirmado por tienda',material:'Algodón',
      composition:'95% algodón',measurements:'Largo 85 cm',care:'Lavar en frío'}},
  {sku:'PAN-001',name:'Pan',price:4500,stock:10,
    facts:{description:'Pan de prueba',ingredients:'Harina, agua y sal',allergens:'Contiene gluten'}},
];
const richExcel=officeModule.previewXlsxFile(makeXlsx(enriched,true));
assert.deepEqual(richExcel.errors,[], 'Excel enriquecido no debe mostrar errores');
assert.deepEqual(richExcel.rows,enriched,'Excel importa campos opcionales de fichas sin cambios');

const richCsv=[
  'SKU;Nombre;Precio;Inventario;Descripcion;Material;Ingredientes;Alergenos',
  'VEST-002;Vestido azul;55000;5;"Vestido azul; confeccionado localmente";Lino;;',
  'PAN-002;Pan artesanal;7000;8;Pan de prueba;;Trigo y agua;Contiene gluten',
].join('\\n');
const richPreview=csvModule.previewCsv(richCsv);
assert.equal(richPreview.rows[0].facts?.description,'Vestido azul; confeccionado localmente',
  'La descripción citada con punto y coma se conserva');
assert.equal(richPreview.rows[0].facts?.material,'Lino');
assert.equal(richPreview.rows[1].facts?.allergens,'Contiene gluten');
assert.deepEqual(richPreview.errors,[]);

const invalidFacts=csvModule.previewCsv(
  'SKU;Nombre;Precio;Inventario;Material\\n'+
  'SKU-001;Camisa;20000;10;'+ 'A'.repeat(251)
);
assert.equal(invalidFacts.rows.length,0,'Un campo demasiado largo bloquea toda la carga');
assert.match(invalidFacts.errors.join(','),/demasiado largo/);

// Backward-compatible: original four-column import has no extra metadata.
assert.ok(!Object.hasOwn(parsedCsv.rows[0],'facts'));

const repeated = csvModule.previewCsv(
  'SKU;Nombre;Precio;Inventario\n'
  + 'REPETIDO-01;Primero;1200;2\nREPETIDO-01;Segundo;1300;3'
);
assert.ok(repeated.errors.some(s => s.includes('repetido')),
  'La vista previa alerta si hay SKU duplicados');

assert.throws(() => officeModule.previewXlsxFile(Buffer.from('XLSX invalido')),
  /XLSX válido|demasiado grande|ZIP/i);
assert.throws(() => officeModule.previewPdfFile(Buffer.from('No soy PDF')),
  /PDF válido/i);

console.log('MW1 QA OK: 3 filas Excel, 3 filas PDF de texto, 3 filas CSV, duplicados y archivos inválidos.');
