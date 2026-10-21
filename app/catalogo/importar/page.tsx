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
  const [errors,setErrors]=useState<string[]>([]);
  const [loading,setLoading]=useState(false);
  const [saved,setSaved]=useState<{imported:number;created:boolean}|null>(null);
  const requestKey=useRef<string|null>(null);
  async function handleFile(event:ChangeEvent<HTMLInputElement>){
    setRows([]);setErrors([]);setSaved(null);requestKey.current=null;
    const file=event.target.files?.[0];
    if(!file)return;
    if(!file.name.toLowerCase().endsWith('.csv')){
      setErrors(['Por ahora selecciona un archivo CSV. Desde Excel utiliza Archivo → Guardar como → CSV UTF-8.']);
      return;
    }
    if(file.size>130000){
      setErrors(['Archivo demasiado grande: el límite de la demo es 130 KB y 100 productos.']);
      return;
    }
    setLoading(true);
    try{
      const text=await file.text();
      const result=previewCsv(text);
      setRows(result.rows);
      setErrors(result.errors);
      setSourceLabel(file.name.replace(/\.csv$/i,'').slice(0,110)||'Catálogo CSV de prueba');
    }catch{
      setErrors(['No fue posible leer el archivo. Exporta un CSV UTF-8 e inténtalo otra vez.']);
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
        body:JSON.stringify({requestKey:requestKey.current,sourceLabel:sourceLabel.trim(),rows}),
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
        <h2>1. Selecciona un archivo CSV</h2>
        <p className={styles.note}>Desde Excel guarda tu hoja como <strong>CSV UTF-8</strong>. Se admiten archivos separados por punto y coma, coma o tabulación.</p>
        <p className={styles.note}>Columnas: <strong>SKU, Nombre, Precio, Inventario</strong> (inventario opcional). Hasta 100 productos por carga. El precio debe estar en pesos colombianos.</p>
        <div className={pageStyles.uploadArea}>
          <input type="file" accept=".csv,text/csv" onChange={e=>void handleFile(e)} disabled={loading||Boolean(saved)} aria-label="Seleccionar catálogo CSV"/>
          <a href="data:text/csv;charset=utf-8,SKU%3BNombre%3BPrecio%3BInventario%0ADEMO-PRUEBA-001%3BGalletas%3B7500%3B20%0ADEMO-PRUEBA-002%3BLeche%3B5400%3B15" download="plantilla_mw1_catalogo.csv">Descargar plantilla CSV</a>
        </div>
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
            <thead><tr><th>Referencia</th><th>Nombre</th><th>Precio</th><th>Inventario</th></tr></thead>
            <tbody>{rows.map(row=><tr key={row.sku}>
              <td>{row.sku}</td><td>{row.name}</td><td>{money(row.price)}</td><td>{row.stock===null?'Sin control':row.stock}</td>
            </tr>)}</tbody>
          </table>
        </div>:<p className={styles.empty}>Selecciona un archivo para revisar sus productos antes de guardarlos.</p>}
      </section>
      <section className={styles.panel}>
        <h2>3. Aprobar importación</h2>
        <p className={styles.note}>MW1 comprobará las referencias repetidas, el límite de tu plan y la seguridad de tu empresa. Si hay un error, no se guarda ningún producto del lote.</p>
        <p className={styles.note}>En esta etapa no se almacenan archivos originales. Solo los productos aprobados, con sus precios e inventario.</p>
        {saved?<div className={pageStyles.success} role="status">
          <strong>{saved.created?'¡Catálogo importado!':'Esta importación ya estaba registrada.'}</strong>
          <p>{saved.imported} productos quedaron asociados únicamente a tu empresa.</p>
          <Link href="/catalogo">Ver catálogo →</Link> · <Link href="/pedidos/simulador">Probar en el chat →</Link>
        </div>:<button className={styles.action} type="button" onClick={()=>void importApproved()}
          disabled={loading||rows.length===0||errors.length>0||sourceLabel.trim().length<3}>
          {loading?'Procesando…':`Importar ${rows.length} productos`}
        </button>}
      </section>
      <p className={styles.disclaimer}>Demo de CSV: PDF y archivos XLSX nativos se incorporarán en una etapa posterior. No utilices datos sensibles ni catálogos reales todavía.</p>
    </main>
  </div>;
}
