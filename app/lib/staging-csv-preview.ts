/** CSV de Excel: punto y coma, coma o tabulación. Solo lectura, sin ejecutar fórmulas. */
export type ImportFactKey='description'|'material'|'composition'|'measurements'|'ingredients'|'allergens'|'care'|'details';
export type ImportFacts=Partial<Record<ImportFactKey,string>>;
export type ImportRow={sku:string;name:string;price:number;stock:number|null;facts?:ImportFacts};

export const IMPORT_FACT_COLUMNS:Record<ImportFactKey,{headers:string[];max:number}>={
  description:{headers:['descripcion','description','descripcionproducto'],max:1200},
  material:{headers:['material','tela','tejido'],max:250},
  composition:{headers:['composicion','composition'],max:350},
  measurements:{headers:['medidas','measurements','guia de tallas','guiadetallas'],max:550},
  ingredients:{headers:['ingredientes','ingredients'],max:700},
  allergens:{headers:['alergenos','alergias','allergens'],max:300},
  care:{headers:['cuidados','conservacion','lavado','care'],max:450},
  details:{headers:['caracteristicas','detalles','details'],max:550},
};

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
  const factColumns=(Object.keys(IMPORT_FACT_COLUMNS) as ImportFactKey[])
    .map(key=>({key,index:find(IMPORT_FACT_COLUMNS[key].headers),max:IMPORT_FACT_COLUMNS[key].max}))
    .filter(field=>field.index>=0&&field.index!==fields.name);
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
    const facts:ImportFacts={};
    for(const column of factColumns){
      const value=(values[column.index]||'').trim();
      if(!value)continue;
      const clean=value.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
      if(clean.length>column.max)issues.push('campo '+column.key+' demasiado largo');
      else facts[column.key]=clean;
    }
    if(issues.length)errors.push(`Fila ${i+1}: ${issues.join(', ')}.`);
    else rows.push(Object.keys(facts).length?{sku,name,price,stock,facts}:{sku,name,price,stock});
    skuSet.add(sku);
  }
  return{rows,errors};
}
