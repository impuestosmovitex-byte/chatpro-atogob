'use client';

import Link from 'next/link';
import {useCallback,useEffect,useState,type FormEvent} from 'react';
import {AppSidebar} from '../../components/AppSidebar';
import styles from '../../pedidos/page.module.css';

type Facts={
  description:string;material:string;composition:string;measurements:string;
  ingredients:string;allergens:string;care:string;details:string;
};
type Product={id:string;sku:string|null;name:string;facts:Facts;published:boolean;available:boolean};
type CatalogResponse={ok:boolean;products?:Product[];error?:string};
const empty=():Facts=>({
  description:'',material:'',composition:'',measurements:'',
  ingredients:'',allergens:'',care:'',details:'',
});
const fields:Array<{key:keyof Facts;label:string;placeholder:string;max:number;rows:number}>=[
  {key:'description',label:'Descripción',max:1200,rows:3,placeholder:'Descripción autorizada de la tienda'},
  {key:'material',label:'Material o tela',max:250,rows:2,placeholder:'Solo si el proveedor lo ha confirmado'},
  {key:'composition',label:'Composición',max:350,rows:2,placeholder:'Ej.: 95% algodón y 5% elastano, si está verificado'},
  {key:'measurements',label:'Medidas / guía de tallas',max:550,rows:3,placeholder:'Longitud, ancho, medidas por talla, unidades'},
  {key:'ingredients',label:'Ingredientes',max:700,rows:3,placeholder:'Para supermercados y alimentos, según etiqueta'},
  {key:'allergens',label:'Alérgenos',max:300,rows:2,placeholder:'Solo información comprobada del empaque'},
  {key:'care',label:'Cuidados y conservación',max:450,rows:2,placeholder:'Lavado, almacenamiento, recomendaciones del fabricante'},
  {key:'details',label:'Otras características',max:550,rows:3,placeholder:'Detalles que realmente aparecen en la ficha'},
];

export default function ProductFactsPage(){
  const[products,setProducts]=useState<Product[]>([]);
  const[selectedId,setSelectedId]=useState('');
  const[facts,setFacts]=useState<Facts>(empty());
  const[loading,setLoading]=useState(true);
  const[saving,setSaving]=useState(false);
  const[notice,setNotice]=useState('');
  const[error,setError]=useState('');
  const reload=useCallback(async()=>{
    setLoading(true);setError('');
    try{
      const res=await fetch('/api/native-commerce/products',{cache:'no-store'});
      const data=await res.json() as CatalogResponse;
      if(!res.ok||!data.ok)throw new Error(data.error||'No se pudo consultar el catálogo.');
      setProducts(data.products||[]);
      setSelectedId(old=>(data.products||[]).some(p=>p.id===old)?old:(data.products?.[0]?.id||''));
    }catch(cause){
      setError(cause instanceof Error?cause.message:'No pude cargar los productos.');
    }finally{setLoading(false);}
  },[]);
  useEffect(()=>{void reload();},[reload]);
  useEffect(()=>{
    const product=products.find(p=>p.id===selectedId);
    setFacts(product?.facts?{...empty(),...product.facts}:empty());
  },[products,selectedId]);
  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!selectedId||saving)return;
    setSaving(true);setNotice('');setError('');
    try{
      const res=await fetch('/api/native-commerce/products/'+encodeURIComponent(selectedId)+'/facts',{
        method:'PATCH',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({facts}),
      });
      const data=await res.json() as {ok?:boolean;error?:string;facts?:Facts};
      if(!res.ok||!data.ok)throw new Error(data.error||'No se pudo guardar la ficha.');
      setProducts(old=>old.map(p=>p.id===selectedId?{...p,facts:data.facts||facts}:p));
      setNotice('Ficha guardada. La IA de pruebas podrá consultar exclusivamente estos datos.');
    }catch(cause){setError(cause instanceof Error?cause.message:'No se pudo guardar.');}
    finally{setSaving(false);}
  }
  const selected=products.find(p=>p.id===selectedId);
  return <div className={styles.shell}>
    <AppSidebar companyName="Empresa de pruebas"/>
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>MW1 · CATÁLOGO · INFORMACIÓN VERIFICADA</p>
          <h1>Fichas de productos</h1>
          <p>Completa la información que la tienda conoce y que la IA podrá consultar sin inventarla.</p>
          <p><Link href="/catalogo">← Catálogo</Link> · <Link href="/catalogo/imagenes">Fotos de productos</Link> · <Link href="/pedidos/simulador">Simular chat →</Link></p>
        </div>
        <button type="button" className={styles.reload} onClick={()=>void reload()} disabled={loading||saving}>
          {loading?'Cargando…':'Actualizar'}
        </button>
      </header>
      <section className={styles.panel}>
        <h2>Selecciona el producto</h2>
        <p className={styles.note}>Los campos corresponden al producto. Para opciones de talla y color, utiliza las variantes del catálogo.</p>
        <select aria-label="Producto a editar" value={selectedId}
          onChange={e=>{setSelectedId(e.target.value);setError('');setNotice('');}} disabled={loading||saving}
          style={{width:'100%',maxWidth:590,padding:12,border:'1px solid #ccc',borderRadius:8}}>
          {!products.length&&<option value="">Sin productos disponibles</option>}
          {products.map(p=><option key={p.id} value={p.id}>{p.name} · {p.sku||'Sin SKU'}</option>)}
        </select>
      </section>
      <section className={styles.panel}>
        <h2>Información de la tienda</h2>
        {!selected?<p>Primero agrega un producto al catálogo.</p>:(
          <form onSubmit={event=>void save(event)}>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(270px,1fr))',gap:18}}>
              {fields.map(field=><label key={field.key} style={{display:'flex',flexDirection:'column',gap:7,fontSize:13,fontWeight:650}}>
                {field.label}
                <textarea rows={field.rows} maxLength={field.max} value={facts[field.key]}
                  onChange={e=>setFacts(old=>({...old,[field.key]:e.target.value}))}
                  placeholder={field.placeholder} disabled={saving}
                  style={{resize:'vertical',padding:11,border:'1px solid #ccc',borderRadius:8,fontSize:13}}/>
                <small style={{fontWeight:400,color:'#747474'}}>
                  {facts[field.key].length}/{field.max} caracteres
                </small>
              </label>)}
            </div>
            <p className={styles.note}>Introduce solo información autorizada y comprobada. No infieras materiales, alérgenos ni medidas a partir de una foto. Los campos vacíos se comunicarán como información pendiente.</p>
            {error&&<p className={styles.error} role="alert">{error}</p>}
            {notice&&<p role="status">{notice}</p>}
            <button type="submit" className={styles.action} disabled={saving}>
              {saving?'Guardando…':'Guardar ficha del producto'}
            </button>
          </form>
        )}
      </section>
      <p className={styles.disclaimer}>Entorno de pruebas. Los cambios no modifican los catálogos de ATOGOB producción.</p>
    </main>
  </div>;
}
