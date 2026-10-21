import { inflateRawSync, inflateSync } from 'node:zlib';
import { previewCsv, type ImportPreview } from './staging-csv-preview';

const MAX_UNCOMPRESSED = 3_000_000;

function decodeXml(value:string):string{
  return value.replace(/&#x([0-9a-f]+);|&#([0-9]+);|&(amp|lt|gt|quot|apos);/gi, (_m,hex,dec,entity)=>{
    if(hex)return String.fromCodePoint(parseInt(hex,16));
    if(dec)return String.fromCodePoint(parseInt(dec,10));
    return ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"} as Record<string,string>)[entity]||'';
  });
}

function zipParts(bytes:Buffer):Map<string,string>{
  if(bytes.length>1_000_000)throw new Error('Archivo Excel demasiado grande (máximo 1 MB).');
  const parts=new Map<string,string>();
  let eocd=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){
    if(bytes.readUInt32LE(i)===0x06054b50){eocd=i;break;}
  }
  if(eocd<0)throw new Error('El archivo no es un XLSX válido.');
  const count=bytes.readUInt16LE(eocd+10);
  const offset=bytes.readUInt32LE(eocd+16);
  if(count>100||offset>=bytes.length)throw new Error('La estructura del Excel no es compatible.');
  let pos=offset, total=0;
  for(let i=0;i<count;i++){
    if(pos+46>bytes.length||bytes.readUInt32LE(pos)!==0x02014b50){
      throw new Error('El archivo Excel está dañado.');
    }
    const flags=bytes.readUInt16LE(pos+8);
    const compression=bytes.readUInt16LE(pos+10);
    const compressed=bytes.readUInt32LE(pos+20);
    const expanded=bytes.readUInt32LE(pos+24);
    const fileLen=bytes.readUInt16LE(pos+28);
    const extra=bytes.readUInt16LE(pos+30);
    const comment=bytes.readUInt16LE(pos+32);
    const localPos=bytes.readUInt32LE(pos+42);
    const name=bytes.subarray(pos+46,pos+46+fileLen).toString('utf8');
    pos+=46+fileLen+extra+comment;
    if(!name.startsWith('xl/')&&!name.startsWith('[Content_Types]'))continue;
    if(name.includes('..')||name.startsWith('/')||flags&1||expanded>MAX_UNCOMPRESSED){
      throw new Error('El Excel contiene elementos no permitidos.');
    }
    if(localPos+30>bytes.length||bytes.readUInt32LE(localPos)!==0x04034b50){
      throw new Error('La estructura ZIP es inválida.');
    }
    const localName=bytes.readUInt16LE(localPos+26);
    const localExtra=bytes.readUInt16LE(localPos+28);
    const start=localPos+30+localName+localExtra;
    if(start+compressed>bytes.length)throw new Error('El archivo está incompleto.');
    const chunk=bytes.subarray(start,start+compressed);
    const output=compression===0?chunk:compression===8?
      inflateRawSync(chunk,{maxOutputLength:MAX_UNCOMPRESSED}):null;
    if(!output||output.length!==expanded)throw new Error('Método de compresión Excel no admitido.');
    total+=output.length;
    if(total>MAX_UNCOMPRESSED)throw new Error('El Excel contiene demasiados datos.');
    parts.set(name,output.toString('utf8'));
  }
  return parts;
}

export function previewXlsxFile(buffer:Buffer):ImportPreview{
  const files=zipParts(buffer);
  const worksheet=files.get('xl/worksheets/sheet1.xml');
  if(!worksheet||!files.has('xl/workbook.xml')){
    throw new Error('El Excel debe tener una hoja inicial con SKU, Nombre, Precio e Inventario.');
  }
  const sharedXml=files.get('xl/sharedStrings.xml')||'';
  const shared=[...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(match=>
    decodeXml([...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map(x=>x[1]).join('')));
  const table:string[][]=[];
  const rows=[...worksheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)];
  if(rows.length>101)throw new Error('Máximo 100 productos por importación.');
  for(const entry of rows){
    const values:string[]=[];
    for(const cell of entry[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)){
      const address=/\br="([A-Z]{1,3})\d+"/.exec(cell[1])?.[1]||'';
      if(!address)continue;
      let index=0;
      for(const chr of address)index=index*26+(chr.charCodeAt(0)-64);
      index-=1;
      if(index>40)continue;
      const kind=/\bt="([^"]+)"/.exec(cell[1])?.[1]||'n';
      const raw=kind==='inlineStr'?
        [...cell[2].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(x=>x[1]).join(''):
        (/<v\b[^>]*>([\s\S]*?)<\/v>/.exec(cell[2])?.[1]||'');
      values[index]=kind==='s'?shared[Number(raw)]||'':decodeXml(raw);
    }
    table.push(values);
  }
  if(!table.length)throw new Error('No encontré filas en la primera hoja de Excel.');
  const csv=table.map(row=>row.map(x=>'"'+String(x||'').replace(/"/g,'""')+'"').join(';')).join('\n');
  return previewCsv(csv);
}

function decodePdfLiteral(input:string):string{
  return input.replace(/\\([0-7]{1,3}|[nrtbf()\\])/g,(_m,value)=>{
    if(/^[0-7]+$/.test(value))return String.fromCharCode(parseInt(value,8));
    return ({n:'\n',r:'\r',t:'\t',b:'\b',f:'\f','(':'(',')':')','\\':'\\'} as Record<string,string>)[value]||value;
  });
}

export function previewPdfFile(buffer:Buffer):ImportPreview{
  if(buffer.length>1_000_000||buffer.subarray(0,5).toString('latin1')!=='%PDF-'){
    throw new Error('Selecciona un PDF válido de máximo 1 MB.');
  }
  const source=buffer.toString('latin1');
  const pieces:string[]=[];
  for(const stream of source.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)){
    const before=source.slice(Math.max(0,stream.index!-350),stream.index);
    let text=stream[1];
    if(/\/FlateDecode/.test(before)){
      const compressed=Buffer.from(text,'latin1');
      try{text=inflateSync(compressed,{maxOutputLength:MAX_UNCOMPRESSED}).toString('latin1');}
      catch{continue;}
    }
    if(text.length>MAX_UNCOMPRESSED)throw new Error('El PDF supera el límite de contenido.');
    for(const item of text.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)){
      pieces.push(decodePdfLiteral(item[1]).trim());
    }
  }
  const header=pieces.findIndex((x,i)=>x==='SKU'&&
    pieces.slice(i+1,i+4).some(y=>/^Nombre$/i.test(y)));
  if(header<0){
    return {rows:[],errors:['No encontré una tabla digital con encabezados SKU, Nombre, Precio e Inventario. Los PDF escaneados requieren OCR.']};
  }
  const entries:string[][]=[];
  for(let i=header+4;i+3<pieces.length;i++){
    if(!/^[A-Z0-9][A-Z0-9._-]{1,63}$/.test(pieces[i])||!/^\d{1,12}([.,]\d{1,2})?$/.test(pieces[i+2])||
      !/^\d{1,10}$/.test(pieces[i+3]))continue;
    entries.push([pieces[i],pieces[i+1],pieces[i+2],pieces[i+3]]);
    i+=3;
    if(entries.length>100)break;
  }
  if(!entries.length){
    return {rows:[],errors:['No encontré filas legibles en el catálogo PDF. Usa un PDF de texto con columnas SKU, Nombre, Precio e Inventario.']};
  }
  return previewCsv([['SKU','Nombre','Precio','Inventario'],...entries]
    .map(row=>row.map(x=>'"'+x.replace(/"/g,'""')+'"').join(';')).join('\n'));
}
