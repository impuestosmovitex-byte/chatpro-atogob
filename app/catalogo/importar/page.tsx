'use client';

import Link from 'next/link';
import { useRef, useState, type ChangeEvent } from 'react';
import { AppSidebar } from '../../components/AppSidebar';
import { previewCsv, type ImportRow } from '../../lib/staging-csv-preview';
import styles from '../../pedidos/page.module.css';
import pageStyles from './page.module.css';

const money=(amount:number)=>new Intl.NumberFormat('es-CO',{
  style:'currency',currency:'COP',maximumFractionDigits:2,
}).format(amount);

export default function ImportCatalogPage(){
  const [sourceLabel,setSourceLabel]=useState('Catálogo de prueba');
  const [rows,setRows]=useState<ImportRow[]>([]);
  const [sourceKind,setSourceKind]=useState<'csv'|'excel'|'pdf'>('csv');
  const [fileNote,setFileNote]=useState('');
  const [errors,setErrors]=useState<string[]>([]);
  const [loading,setLoading]=useState(false);
  const [saved,setSaved]=useState<{imported:number;created:boolean}|null>(null);
  const requestKey=useRef<string|null>(null);
  async function handleFile(event:ChangeEvent<HTMLInputElement>){
    setRows([]);setErrors([]);setSaved(null);setFileNote('');requestKey.current=null;
    const file=event.target.files?.[0];
    if(!file)return;
    const name=file.name.toLowerCase();
    const kind:'csv'|'excel'|'pdf'|null=name.endsWith('.csv')?'csv':
      name.endsWith('.xlsx')?'excel':name.endsWith('.pdf')?'pdf':null;
    if(!kind){
      setErrors(['Selecciona un archivo CSV, Excel (.xlsx) o PDF de texto.']);
      return;
    }
    if(file.size>(kind==='csv'?130000:1000000)){
      setErrors(['Archivo demasiado grande: CSV máximo 130 KB; Excel y PDF máximo 1 MB.']);
      return;
    }
    setLoading(true);
    try{
      let result:{rows:ImportRow[];errors:string[];notes?:string};
      if(kind==='csv'){
        const text=await file.text();
        result=previewCsv(text);
      }else{
        const formData=new FormData();
        formData.append('file',file);
        const response=await fetch('/api/native-commerce/catalog/parse-file',{
          method:'POST',body:formData,
        });
        const data=await response.json();
        if(!response.ok||!data.ok){
          throw new Error(data.error||'No fue posible leer el archivo.');
        }
        result={rows:data.rows||[],errors:data.errors||[],notes:data.notes||''};
      }
      setRows(result.rows);
      setErrors(result.errors);
      setSourceKind(kind);
      setFileNote(result.notes||'');
      setSourceLabel(file.name.replace(/\.(csv|xlsx|pdf)$/i,'').slice(0,110)||'Catálogo de prueba');
    }catch(cause){
      setErrors([cause instanceof Error?cause.message:
        'No fue posible interpretar el archivo. Revisa su formato.']);
    }finally{setLoading(false);}
  }
  async function importApproved(){
    if(!rows.length||errors.length||loading||saved)return;
    setLoading(true);setErrors([]);
    try{
      if(!requestKey.current)requestKey.current=crypto.randomUUID();
      const response=await fetch('/api/native-commerce/catalog/import-csv',{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({requestKey:requestKey.current,sourceLabel:sourceLabel.trim(),sourceKind,rows}),
      });
      const data=await response.json();
      if(!response.ok||!data.ok)throw new Error(data.error||'No fue posible importar el catálogo.');
      setSaved({imported:data.imported,created:Boolean(data.created)});
    }catch(cause){
      setErrors([cause instanceof Error?cause.message:'Error al importar. Revisa el catálogo.']);
    }finally{setLoading(false);}
  }
  return <div className={styles.shell}>
    <AppSidebar companyName="Empresa"/>
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>MW1 COMERCIO · FUENTES DE PRODUCTOS</p>
          <h1>Importar catálogo</h1>
          <p>Carga una lista de productos para vender sin Shopify ni tienda virtual.</p>
          <p><Link href="/catalogo">← Volver a Catálogo</Link></p>
        </div>
      </header>
      <section className={styles.panel}>
        <h2>1. Selecciona tu catálogo: Excel, PDF o CSV</h2>
        <p className={styles.note}>Puedes cargar un <strong>Excel (.xlsx)</strong> directamente, un <strong>PDF con texto y tabla de productos</strong> o un CSV.</p>
        <div role="note" style={{border:'1px solid #cbd5e1',borderRadius:12,padding:14,margin:'14px 0'}}>
          <strong>¿Qué tipo de archivo tienes?</strong>
          <p><strong>Excel o CSV:</strong> cada combinacion de talla y color debe tener una referencia SKU exclusiva y su propia cantidad. Por ahora el importador crea entradas individuales, no agrupa variantes automaticamente en un solo producto.</p>
          <p><strong>PDF con texto:</strong> solo para tablas sencillas. Los catálogos escaneados o basados en fotografías todavía no se interpretan automáticamente.</p>
          <p><strong>Sin archivo:</strong> puedes <Link href="/catalogo">crear productos manualmente</Link>. No inventamos precios ni existencias ausentes.</p>
        </div>
        <p className={styles.note}>Columnas obligatorias: <strong>SKU, Nombre y Precio</strong>. Opcionales: Inventario, Descripción, Material, Composición, Medidas, Ingredientes, Alérgenos, Cuidados y Características. Las fichas enriquecidas se leen de Excel y CSV; el PDF sencillo reconoce por ahora SKU, nombre, precio e inventario.</p>
        <div className={pageStyles.uploadArea}>
          <input type="file" accept=".xlsx,.pdf,.csv,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={e=>void handleFile(e)} disabled={loading||Boolean(saved)} aria-label="Seleccionar catálogo Excel, PDF o CSV"/>
          <a href="data:text/csv;charset=utf-8,SKU%3BNombre%3BPrecio%3BInventario%3BDescripcion%3BMaterial%3BMedidas%3BIngredientes%3BAlergenos%0ADEMO-VEST-001%3BVestido%3B49000%3B12%3BModelo%20de%20prueba%3BAlgodon%3BLargo%2085%20cm%3B%3B%0ADEMO-PAN-001%3BPan%3B4500%3B10%3BPan%20de%20prueba%3B%3B%3BHarina%20y%20agua%3BContiene%20gluten" download="plantilla_mw1_catalogo_completo.csv">Descargar plantilla con fichas</a>
        </div>
        {fileNote&&<p className={styles.note} role="status">{fileNote}</p>}
        <label className={pageStyles.label}>Nombre de esta fuente
          <input value={sourceLabel} onChange={e=>setSourceLabel(e.target.value)} minLength={3} maxLength={120} disabled={loading||Boolean(saved)}/>
        </label>
      </section>
      <section className={styles.panel}>
        <div className={styles.toolbar}>
          <h2>2. Revisa la vista previa</h2>
          <span className={styles.note}>{rows.length} productos válidos · {errors.length} observaciones</span>
        </div>
        {errors.length>0&&<div className={styles.error} role="alert">
          <strong>Corrige estos datos antes de importar:</strong>
          <ul>{errors.slice(0,12).map((error,index)=><li key={index}>{error}</li>)}</ul>
          {errors.length>12?<p>Hay {errors.length-12} observaciones adicionales.</p>:null}
        </div>}
        {rows.length?<div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead><tr><th>Referencia</th><th>Nombre</th><th>Precio</th><th>Inventario</th><th>Talla / color / presentación</th><th>Ficha</th></tr></thead>
            <tbody>{rows.map(row=><tr key={row.sku}>
              <td>{row.sku}</td><td>{row.name}</td><td>{money(row.price)}</td><td>{row.stock===null?'Sin control':row.stock}</td><td>{row.facts?.details?.split(' | ').filter(part=>/^(Talla|Color|Presentación):/.test(part)).join(' · ')||'No especificada'}</td><td>{Object.keys(row.facts||{}).length?`${Object.keys(row.facts||{}).length} campos`: 'Sin detalles'}</td>
            </tr>)}</tbody>
          </table>
        </div>:<p className={styles.empty}>Selecciona un archivo para revisar sus productos antes de guardarlos.</p>}
      </section>
      <section className={styles.panel}>
        <h2>3. Aprobar importación</h2>
        <p className={styles.note}>MW1 comprobará las referencias repetidas, el límite de tu plan y la seguridad de tu empresa. Si hay un error, no se guarda ningún producto del lote.</p>
        <p className={styles.note}>Los archivos originales no se almacenan. Se guardan únicamente los productos aprobados y los detalles suministrados por la tienda, sin generar características automáticamente.</p>
        {saved?<div className={pageStyles.success} role="status">
          <strong>{saved.created?'¡Catálogo importado!':'Esta importación ya estaba registrada.'}</strong>
          <p>{saved.imported} productos quedaron asociados únicamente a tu empresa.</p>
          <Link href="/catalogo">Ver catálogo →</Link> · <Link href="/catalogo/fichas">Revisar fichas →</Link> · <Link href="/pedidos/simulador">Probar en el chat →</Link>
        </div>:<button className={styles.action} type="button" onClick={()=>void importApproved()}
          disabled={loading||rows.length===0||errors.length>0||sourceLabel.trim().length<3}>
          {loading?'Procesando…':`Importar ${rows.length} productos`}
        </button>}
      </section>
      <p className={styles.disclaimer}>Esta es una primera prueba con archivos pequeños y tablas sencillas. Los PDF escaneados, los Excel de varias hojas y los catálogos extensos necesitarán un importador más completo. No cargues archivos sensibles ni catálogos reales todavía.</p>
    </main>
  </div>;
}
