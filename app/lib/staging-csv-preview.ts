/** CSV de Excel: punto y coma, coma o tabulación. Solo lectura, sin ejecutar fórmulas. */
export type ImportRow={sku:string;name:string;price:number;stock:number|null};
export type ImportPreview={rows:ImportRow[];errors:string[]};

function normalizeHeader(raw:string){
  return raw.normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/[^a-z0-9]+/g,'').trim();
}

function csvCells(text:string,delimiter:string):string[][]{
  const result:string[][]=[];
  let row:string[]=[],field='',inside=false;
  const content=text.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n').replace(/\r/g,'\n');
  for(let i=0;i<content.length;i++){
    const char=content[i];
    if(char==='"'){
      if(inside && content[i+1]==='"'){field+='"';i++;}
      else inside=!inside;
    } else if(!inside && char===delimiter){
      row.push(field.trim());field='';
    } else if(!inside && char==='\n'){
      row.push(field.trim());
      if(row.some(x=>x.length))result.push(row);
      row=[];field='';
    }else{field+=char;}
  }
  if(inside)throw new Error('El archivo tiene comillas sin cerrar.');
  row.push(field.trim());
  if(row.some(x=>x.length))result.push(row);
  return result;
}

function numericCOP(value:string):number{
  const normalized=value.replace(/\s/g,'').replace(/^COP/i,'').replace(/^\$/,'');
  if(!normalized)return Number.NaN;
  let clean=normalized;
  if(/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(clean)){
    clean=clean.replace(/\./g,'').replace(',','.');
  }else if(/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(clean)){
    clean=clean.replace(/,/g,'');
  }else if(/^\d+(,\d{1,2})$/.test(clean)){
    clean=clean.replace(',','.');
  }else if(!/^\d+(\.\d{1,2})?$/.test(clean)){
    return Number.NaN;
  }
  return Number(clean);
}

export function previewCsv(text:string):ImportPreview{
  const errors:string[]=[];
  const first=text.replace(/^\uFEFF/,'').split(/\r?\n/,1)[0]||'';
  // Source file is expected to start with a header; detect the column delimiter.
  const delimiters=[';',',','\t'];
  const delimiter=delimiters.reduce((a,b)=>
    csvCells(first,b)[0]?.length>csvCells(first,a)[0]?.length?b:a);
  const table=csvCells(text,delimiter);
  if(table.length<2)return{rows:[],errors:['Incluye una fila de encabezados y al menos un producto.']};
  if(table.length>101)return{rows:[],errors:['El máximo es de 100 productos por importación.']};
  const header=table[0].map(normalizeHeader);
  const find=(keys:string[])=>header.findIndex(x=>keys.includes(x));
  const fields={
    sku:find(['sku','referencia','codigo','codigoproducto','ref']),
    name:find(['nombre','producto','name','nombreproducto','descripcion']),
    price:find(['precio','price','valor','preciocop','precioventa']),
    stock:find(['inventario','stock','existencias','cantidadinventario','disponible']),
  };
  if(fields.sku<0||fields.name<0||fields.price<0) {
    return {rows:[],errors:['El archivo debe tener las columnas SKU, Nombre y Precio. Inventario es opcional.']};
  }
  const rows:ImportRow[]=[];
  const skuSet=new Set<string>();
  for(let i=1;i<table.length;i++){
    const values=table[i];
    const sku=(values[fields.sku]||'').trim().toUpperCase();
    const name=(values[fields.name]||'').trim();
    const price=numericCOP(values[fields.price]||'');
    const stockString=fields.stock>=0?(values[fields.stock]||'').trim():'';
    const stock=stockString?numericCOP(stockString):null;
    const issues:string[]=[];
    if(!/^[A-Z0-9._-]{2,64}$/.test(sku))issues.push('SKU inválido');
    if(name.length<2||name.length>180)issues.push('nombre inválido');
    if(!Number.isFinite(price)||price<0||price>999999999999||
      Math.round(price*100)!==price*100)issues.push('precio inválido');
    if(stock!==null&&(!Number.isFinite(stock)||stock<0||
      Math.round(stock*1000)!==stock*1000))issues.push('inventario inválido');
    if(skuSet.has(sku))issues.push('SKU repetido');
    if(issues.length)errors.push(`Fila ${i+1}: ${issues.join(', ')}.`);
    else rows.push({sku,name,price,stock});
    skuSet.add(sku);
  }
  return{rows,errors};
}
