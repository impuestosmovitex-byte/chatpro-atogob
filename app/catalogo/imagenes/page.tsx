'use client';
import Link from 'next/link';
import { useCallback,useEffect,useState } from 'react';
import { AppSidebar } from '../../components/AppSidebar';
import styles from '../../pedidos/page.module.css';

type Product={id:string;name:string};
type Variant={id:string;product_id:string;variant_label:string;sku:string|null};
type Picture={imageId:string;productId:string;variantId:string;previewUrl:string|null};
type Selected={base64:string;mimeType:string;preview:string};

async function readPicture(file:File):Promise<Selected>{
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>524288||file.size<200)
    throw new Error('Selecciona una foto JPEG, PNG o WebP de máximo 512 KB.');
  const data=await new Promise<string>((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('No pude leer la imagen.'));
    reader.readAsDataURL(file);
  });
  return{base64:data.split(',')[1],mimeType:file.type,preview:data};
}
export default function CatalogImagesPage(){
  const[products,setProducts]=useState<Product[]>([]);
  const[variants,setVariants]=useState<Variant[]>([]);
  const[photos,setPhotos]=useState<Picture[]>([]);
  const[variantId,setVariantId]=useState('');
  const[selected,setSelected]=useState<Selected|null>(null);
  const[loading,setLoading]=useState(true);
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState('');
  const[notice,setNotice]=useState('');
  const load=useCallback(async()=>{
    setLoading(true);
    try{
      const urls=['/api/native-commerce/products','/api/native-commerce/variants','/api/native-commerce/catalog/images'];
      const res=await Promise.all(urls.map(u=>fetch(u,{cache:'no-store'})));
      const parsed=await Promise.all(res.map(x=>x.json()));
      if(res.some(x=>!x.ok)||parsed.some(x=>!x.ok))throw new Error('No pude consultar las fotos y productos.');
      setProducts(parsed[0].products||[]);
      setVariants(parsed[1].variants||[]);
      setPhotos(parsed[2].photos||[]);
    }catch(e){setError(e instanceof Error?e.message:'Error al cargar el catálogo.');}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{void load();},[load]);
  async function upload(){
    if(!selected||!variantId||busy)return;
    setBusy(true);setError('');setNotice('');
    try{
      const res=await fetch('/api/native-commerce/catalog/images',{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({variantId,base64:selected.base64,mimeType:selected.mimeType}),
      });
      const result=await res.json();
      if(!res.ok||!result.ok)throw new Error(result.error||'No pude guardar la fotografía.');
      setSelected(null);setNotice('Foto asociada a la variante correcta en el catálogo de pruebas.');
      await load();
    }catch(e){setError(e instanceof Error?e.message:'Error al subir la imagen.');}
    finally{setBusy(false);}
  }
  return <div className={styles.shell}>
    <AppSidebar companyName="Empresa de pruebas"/>
    <main className={styles.main}>
      <header className={styles.header}><div>
        <p className={styles.eyebrow}>MW1 · CATÁLOGO VISUAL</p>
        <h1>Fotografías de productos</h1>
        <p>Asocia una fotografía a la referencia y variante exactas. Luego podrás probar la búsqueda por imagen.</p>
        <p><Link href="/catalogo">← Catálogo</Link> · <Link href="/pedidos/simulador">Simular chat →</Link></p>
      </div></header>
      <section className={styles.panel}>
        <h2>Agregar foto al catálogo</h2>
        <p className={styles.note}>Primera prueba: JPEG, PNG o WebP, máximo 512 KB. Utiliza imágenes ficticias o autorizadas.</p>
        <div className={styles.dispatchGrid}>
          <label>Producto y variante
            <select value={variantId} onChange={e=>setVariantId(e.target.value)}>
              <option value="">Selecciona una referencia</option>
              {variants.map(v=>{
                const p=products.find(p=>p.id===v.product_id);
                return <option key={v.id} value={v.id}>{p?.name||'Producto'} · {v.variant_label} · {v.sku||'Sin SKU'}</option>;
              })}
            </select>
          </label>
          <label>Fotografía
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={async e=>{
              setSelected(null);setError('');
              const file=e.target.files?.[0];if(!file)return;
              try{setSelected(await readPicture(file));}catch(err){setError(err instanceof Error?err.message:'Archivo inválido.');}
            }}/>
          </label>
        </div>
        {selected&&<img src={selected.preview} alt="Vista previa de la foto seleccionada" style={{maxWidth:220,maxHeight:220,objectFit:'contain',borderRadius:10}}/>}
        {error&&<p className={styles.error} role="alert">{error}</p>}
        {notice&&<p role="status">{notice}</p>}
        <div><button className={styles.action} type="button" disabled={!selected||!variantId||busy||loading} onClick={()=>void upload()}>
          {busy?'Guardando…':'Guardar foto del producto'}
        </button></div>
      </section>
      <section className={styles.panel}>
        <h2>Fotos registradas ({photos.length})</h2>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(155px,1fr))',gap:12}}>
          {photos.map(pic=>{
            const v=variants.find(v=>v.id===pic.variantId);
            const p=products.find(p=>p.id===pic.productId);
            return <div key={pic.imageId} style={{border:'1px solid #ddd',padding:10,borderRadius:10}}>
              {pic.previewUrl?<img src={pic.previewUrl} alt={p?.name||'Fotografía del catálogo'}
                style={{width:'100%',height:130,objectFit:'contain'}}/>:<p>Sin vista previa</p>}
              <strong style={{fontSize:12}}>{p?.name||'Producto'}</strong>
              <p style={{fontSize:11}}>{v?.variant_label||''}</p>
            </div>;
          })}
        </div>
        {!loading&&!photos.length&&<p className={styles.empty}>Todavía no hay fotos en este catálogo.</p>}
      </section>
    </main>
  </div>;
}
